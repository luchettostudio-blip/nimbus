/**
 * Modelli dati del dominio email.
 *
 * Questi tipi sono la "lingua comune" fra servizi IMAP/SMTP, cache SQLite,
 * motore di sync e UI. Sono volutamente semplici (solo dati, niente metodi)
 * per poter essere tradotti 1:1 in `struct` Swift (Codable) nella futura
 * versione SwiftUI.
 */

/** Configurazione di un server (IMAP o SMTP). */
export interface ServerConfig {
  host: string
  port: number
  /** true = TLS implicito (993 / 465). false = STARTTLS o plain (143 / 587). */
  secure: boolean
  /** Con secure=false: rifiuta di procedere se il server non offre STARTTLS. */
  requireTLS?: boolean
}

/** Account configurato dall'utente. La password NON fa parte del modello: vive nel credential store. */
export interface Account {
  id: string
  email: string
  displayName: string
  imap: ServerConfig
  smtp: ServerConfig
  /** Server SMTP alternativi, provati in ordine se il principale fallisce o va in timeout. */
  smtpFallbacks?: ServerConfig[]
  /** Username di login; quasi sempre coincide con l'email. */
  username: string
  /** Provider scelto in onboarding (es. "studio-marla", "gmail", "other"). */
  providerId?: string
  /**
   * true = dopo l'invio salva una copia in "Inviata" con IMAP APPEND (es. Register.it).
   * false = il server SMTP lo fa già da solo (Gmail, Outlook): evita i doppioni.
   */
  saveSentCopy?: boolean
  createdAt: number
}

/** Dati raccolti dall'onboarding (include la password, che verrà cifrata subito). */
export interface NewAccountInput {
  email: string
  displayName?: string
  username?: string
  password: string
  imap: ServerConfig
  smtp: ServerConfig
  smtpFallbacks?: ServerConfig[]
  providerId?: string
  saveSentCopy?: boolean
}

/**
 * Preset di un provider (vedi src/main/config/providers.ts).
 * Con un preset l'utente inserisce solo email e password.
 */
export interface ProviderPreset {
  id: string
  label: string
  /** Riga sotto il nome nella griglia. */
  description?: string
  /** Mostrato per primo e in evidenza. */
  featured?: boolean
  /** File SVG/PNG in src/renderer/src/assets/providers/. Se manca si usa il monogramma. */
  logo?: string
  /** Colore del monogramma (e dell'accento della tessera). */
  color: string
  monogram: string
  /** true = "Altro": l'utente compila tutti i campi a mano. */
  manual?: boolean
  /** Domini riconosciuti automaticamente (opzionale). */
  domains: string[]
  imap: ServerConfig
  smtp: ServerConfig
  smtpFallbacks?: ServerConfig[]
  /** Link alla pagina per creare la password per le app, se serve. */
  appPassword?: { label: string; url: string }
  /** Nota mostrata sotto il campo password. */
  passwordHint?: string
  /** false se il server SMTP salva già da solo la copia in "Inviata" (default true). */
  saveSentCopy?: boolean
}

/** Ruolo "speciale" di una cartella (RFC 6154 SPECIAL-USE), normalizzato. */
export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | null

export interface Folder {
  accountId: string
  /** Path IMAP completo, es. "INBOX" o "[Gmail]/Sent Mail". È l'identificativo. */
  path: string
  name: string
  role: FolderRole
  delimiter: string
  unread: number
  total: number
  /** UIDVALIDITY: se cambia, la cache della cartella va invalidata. */
  uidValidity: number
}

export interface Address {
  name: string
  address: string
}

/** Riga della lista messaggi: tutto ciò che serve per mostrarla senza scaricare il corpo. */
/** Scheda dell'inbox divisa. */
export type InboxCategory = 'people' | 'newsletter' | 'notifications'

export interface MessageSummary {
  accountId: string
  folder: string
  uid: number
  messageId: string | null
  subject: string
  from: Address | null
  to: Address[]
  date: number
  snippet: string
  seen: boolean
  flagged: boolean
  hasAttachments: boolean

  // ── header aggiuntivi (thread, classificazione, disiscrizione) ──
  inReplyTo?: string | null
  references?: string[]
  listUnsubscribe?: string | null
  listUnsubscribePost?: string | null
  listId?: string | null
  precedence?: string | null
  autoSubmitted?: string | null
  /** Nomi degli allegati separati da spazio (per la ricerca). */
  attachmentNames?: string

  // ── calcolati localmente ──
  threadId?: string | null
  category?: InboxCategory | null
  /** Se la mail è tornata da uno snooze: quando (per l'etichetta "Rimandata"). */
  wokeAt?: number | null
}

export interface AttachmentInfo {
  /** Posizione fra gli allegati del messaggio (chiave per anteprima e cache). */
  index: number
  filename: string
  contentType: string
  size: number
}

/** Corpo completo di un messaggio (scaricato on-demand e messo in cache). */
export interface MessageBody {
  accountId: string
  folder: string
  uid: number
  html: string | null
  text: string | null
  cc: Address[]
  replyTo: Address[]
  inReplyTo: string | null
  references: string[]
  attachments: AttachmentInfo[]
}

/** Bozza/messaggio in uscita. */
/** Allegato in uscita. `cid` presente = immagine inline (es. logo della firma). Contenuto in base64. */
export interface OutgoingAttachment {
  filename: string
  contentType: string
  contentBase64: string
  cid?: string
}

/** Messaggio MIME pronto per l'SMTP (costruito da `buildOutgoing`). */
export interface OutgoingMessage {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  inReplyTo?: string
  references?: string[]
  attachments?: OutgoingAttachment[]
}

/**
 * Bozza come la produce il compositore: testo dell'utente + firma scelta + testo citato.
 * Il main la trasforma in `OutgoingMessage` (HTML compatibile Gmail/Outlook, immagini CID).
 */
export interface DraftMessage {
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  /** Testo scritto dall'utente. */
  body: string
  /** Firma da inserire (sopra il testo citato). null = nessuna. */
  signatureId?: string | null
  /** Testo citato in risposte/inoltri. */
  quoted?: { header: string; text: string } | null
  inReplyTo?: string
  references?: string[]
}

/** Firma di un account. `html` contiene <img src="cid:…"> per le immagini. */
export interface Signature {
  id: string
  accountId: string
  name: string
  html: string
  updatedAt: number
}

/** Firma pronta per editor/anteprima: le immagini cid: sono sostituite da data URI (con data-cid). */
export interface SignatureView extends Signature {
  previewHtml: string
}

export interface SignaturePrefs {
  /** Firma predefinita per le nuove mail. */
  newId: string | null
  /** Firma predefinita per risposte e inoltri. */
  replyId: string | null
}

/** Immagine della firma già ridimensionata e compressa. */
export interface SignatureImage {
  cid: string
  mime: string
  width: number
  height: number
  dataUrl: string
}

/** Impostazioni globali dell'app (tabella kv, chiave "settings"). */
export interface AppSettings {
  /** Secondi di "Annulla invio". */
  undoSendSeconds: 5 | 10 | 20 | 30
  /** Chiudere la finestra la riduce nella tray (gli invii programmati continuano). */
  closeToTray: boolean
  /** Avvia Nimbus all'accensione del PC (ridotto nella tray). */
  launchAtLogin: boolean
  /** Mesi di posta da indicizzare per la ricerca full-text. */
  indexMonths: number
  /** Conversazioni raggruppate in thread. */
  threads: boolean
  /** Posta in arrivo divisa in Persone / Newsletter / Notifiche. */
  splitInbox: boolean
  /** Notifiche di Windows solo per la scheda Persone. */
  notifyOnlyPeople: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  undoSendSeconds: 10,
  closeToTray: true,
  launchAtLogin: false,
  indexMonths: 12,
  threads: true,
  splitInbox: true,
  notifyOnlyPeople: true
}

export type OutboxKind = 'undo' | 'scheduled'

/** Messaggio in uscita in coda (annulla invio o programmato). */
export interface OutboxItem {
  id: string
  accountId: string
  draft: DraftMessage
  /** Tipo di compositore (new/reply/replyAll/forward), per riaprirlo uguale. */
  mode: string
  sendAt: number
  kind: OutboxKind
  /** pending = in attesa · sending = in invio · missed = orario passato a PC spento · failed = errore */
  status: 'pending' | 'sending' | 'missed' | 'failed'
  error: string | null
  attempts: number
  createdAt: number
}

/** Mail rimandata (snooze), in attesa del risveglio. */
export interface SnoozeItem {
  id: string
  accountId: string
  messageId: string
  subject: string
  from: Address | null
  snippet: string
  originalFolder: string
  wakeAt: number
  createdAt: number
}

/** Eventi emessi dal motore di sync verso la UI. */
export type SyncEvent =
  | { type: 'folders'; accountId: string }
  | { type: 'messages'; accountId: string; folder: string }
  | { type: 'new-mail'; accountId: string; folder: string; messages: MessageSummary[] }
  | { type: 'status'; accountId: string; state: 'connecting' | 'syncing' | 'idle' | 'offline' | 'error'; error?: string }
  | { type: 'outbox' }
  | { type: 'outbox-sent'; id: string; kind: OutboxKind; subject: string }
  | { type: 'outbox-failed'; id: string; kind: OutboxKind; error: string }
  | { type: 'outbox-missed'; count: number }
  | { type: 'snooze' }
  | { type: 'snooze-woke'; accountId: string; folder: string; uid: number; subject: string; from: Address | null }
