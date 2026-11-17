/**
 * ImapService — wrapper tipizzato attorno a `imapflow` per UN account.
 *
 * Responsabilità:
 *  - aprire/chiudere connessioni IMAP
 *  - elencare cartelle (con conteggi e ruolo SPECIAL-USE)
 *  - scaricare intestazioni + anteprima (snippet) e corpi completi
 *  - modificare flag, spostare, eliminare messaggi
 *  - mantenere una connessione dedicata in IDLE per le notifiche push
 *
 * Usa DUE connessioni:
 *  - `cmd`  : comandi on-demand (fetch, flag, move…). imapflow serializza gli
 *             accessi alle cartelle tramite `getMailboxLock`.
 *  - `idle` : resta selezionata su INBOX; imapflow entra automaticamente in
 *             IDLE quando la connessione è inattiva ed emette `exists` quando
 *             arrivano nuovi messaggi.
 *
 * Non conosce né SQLite né Electron: riceve config + password, restituisce modelli.
 * Equivalente Swift previsto: un `actor ImapService` basato su una libreria IMAP
 * (es. MailCore2 / swift-nio-imap) che espone le stesse operazioni async.
 */
import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageAddressObject } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import { toSetupError } from '../errors'
import type { AttachmentFile } from '../features/attachments/AttachmentCache'
import type { Account, Address, AttachmentInfo, Folder, FolderRole, MessageBody, MessageSummary } from '../models'

export interface ImapCredentials {
  account: Account
  password: string
}

/** Byte di sorgente scaricati per costruire lo snippet di anteprima. */
const SNIPPET_SOURCE_BYTES = 12 * 1024
const SNIPPET_LENGTH = 180

/** Header extra scaricati con ogni riepilogo (thread, inbox divisa, disiscrizione). */
const EXTRA_HEADERS = ['references', 'in-reply-to', 'list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'precedence', 'auto-submitted']

export class ImapService {
  private cmd: ImapFlow | null = null
  private idle: ImapFlow | null = null

  constructor(private readonly creds: ImapCredentials) {}

  /**
   * @param forIdle true per la connessione push: IDLE automatico appena inattiva.
   *                false per la connessione comandi: niente IDLE (evita di
   *                interrompere/riavviare IDLE a ogni comando).
   */
  private createClient(forIdle = false): ImapFlow {
    const { account, password } = this.creds
    const client = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      // Senza SSL diretto: STARTTLS obbligatorio se richiesto, altrimenti "se disponibile".
      doSTARTTLS: !account.imap.secure && account.imap.requireTLS ? true : undefined,
      auth: { user: account.username, pass: password },
      logger: false,
      disableAutoIdle: !forIdle,
      // Timeout brevi: una porta bloccata deve dare errore in secondi, non in minuti.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      autoIdleDelay: 1000,
      // Ri-emette IDLE periodicamente: alcuni server chiudono IDLE lunghi.
      maxIdleTime: 5 * 60 * 1000
    })
    // Senza un listener 'error' un errore di rete farebbe crashare il processo.
    client.on('error', () => {})
    return client
  }

  /**
   * Verifica le credenziali: apre una connessione e la chiude subito.
   * In caso di errore lancia un `MailSetupError` con messaggio in italiano.
   */
  static async testConnection(creds: ImapCredentials): Promise<void> {
    const svc = new ImapService(creds)
    const client = svc.createClient()
    try {
      await client.connect()
    } catch (err) {
      client.close()
      throw toSetupError('imap', creds.account.imap, err)
    }
    await client.logout().catch(() => client.close())
  }

  // ───────────────────────────── connessione comandi ─────────────────────────────

  async connect(onClose: () => void): Promise<void> {
    if (this.cmd?.usable) return
    const client = this.createClient()
    client.on('close', onClose)
    await client.connect()
    this.cmd = client
  }

  private get client(): ImapFlow {
    if (!this.cmd?.usable) throw new Error('IMAP non connesso')
    return this.cmd
  }

  get isConnected(): boolean {
    return !!this.cmd?.usable
  }

  async disconnect(): Promise<void> {
    await this.stopIdle()
    const c = this.cmd
    this.cmd = null
    if (c) {
      c.removeAllListeners('close')
      await c.logout().catch(() => c.close())
    }
  }

  // ───────────────────────────── cartelle ─────────────────────────────

  async listFolders(): Promise<Folder[]> {
    const list = await this.client.list({
      statusQuery: { messages: true, unseen: true, uidValidity: true }
    })
    return list
      .filter((f) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
      .map((f) => this.toFolder(f))
  }

  private toFolder(f: ListResponse): Folder {
    return {
      accountId: this.creds.account.id,
      path: f.path,
      name: f.path.toUpperCase() === 'INBOX' ? 'Inbox' : f.name,
      role: roleFromSpecialUse(f.path, f.specialUse),
      delimiter: f.delimiter,
      unread: f.status?.unseen ?? 0,
      total: f.status?.messages ?? 0,
      uidValidity: Number(f.status?.uidValidity ?? 0)
    }
  }

  /** Conteggi aggiornati di una cartella (STATUS, non richiede di selezionarla). */
  async status(path: string): Promise<{ unread: number; total: number }> {
    const s = await this.client.status(path, { messages: true, unseen: true })
    return { unread: s.unseen ?? 0, total: s.messages ?? 0 }
  }

  /**
   * Cartella "Nimbus/Rimandate" per lo snooze. imapflow applica da solo prefisso
   * (es. "INBOX.") e separatore del server. La crea se non esiste.
   */
  async ensureSnoozeFolder(): Promise<string> {
    const find = async () => {
      const list = await this.client.list()
      return list.find((f) => f.name === 'Rimandate' && /(^|[./])Nimbus$/.test(f.parentPath))?.path
    }
    const existing = await find()
    if (existing) return existing
    await this.client.mailboxCreate(['Nimbus']).catch(() => {})
    const created = await this.client.mailboxCreate(['Nimbus', 'Rimandate']).catch(() => null)
    const path = created?.path ?? (await find())
    if (!path) throw new Error('Impossibile creare la cartella "Nimbus/Rimandate" sul server.')
    return path
  }

  /** UID del messaggio con questo Message-ID nella cartella (il più recente), o null. */
  async findByMessageId(path: string, messageId: string): Promise<number | null> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    try {
      const res = await this.client.search({ header: { 'message-id': messageId } }, { uid: true })
      const uids = (res || []).sort((a, b) => a - b)
      return uids.length ? uids[uids.length - 1] : null
    } finally {
      lock.release()
    }
  }

  async createFolder(path: string): Promise<void> {
    await this.client.mailboxCreate(path)
  }

  // ───────────────────────────── messaggi ─────────────────────────────

  /**
   * Stato corrente di una cartella (apre la mailbox in sola lettura).
   */
  async folderState(path: string): Promise<{ uidValidity: number; exists: number; uidNext: number }> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    try {
      const mb = this.client.mailbox
      if (!mb) throw new Error(`Cartella non aperta: ${path}`)
      return { uidValidity: Number(mb.uidValidity), exists: mb.exists, uidNext: mb.uidNext }
    } finally {
      lock.release()
    }
  }

  /** Scarica i messaggi con UID > `afterUid` (sync incrementale). */
  async fetchNewerThan(path: string, afterUid: number): Promise<MessageSummary[]> {
    return this.fetchSummaries(path, `${afterUid + 1}:*`, true, (m) => m.uid > afterUid)
  }

  /** Scarica gli ultimi `count` messaggi della cartella (prima sincronizzazione). */
  async fetchLatest(path: string, count: number): Promise<MessageSummary[]> {
    const { exists } = await this.folderState(path)
    if (exists === 0) return []
    const from = Math.max(1, exists - count + 1)
    return this.fetchSummaries(path, `${from}:*`, false)
  }

  /** Scarica fino a `count` messaggi più vecchi di `beforeUid` (scroll infinito). */
  async fetchOlderThan(path: string, beforeUid: number, count: number): Promise<MessageSummary[]> {
    if (beforeUid <= 1) return []
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    let uids: number[] = []
    try {
      const res = await this.client.search({ uid: `1:${beforeUid - 1}` }, { uid: true })
      uids = (res || []).sort((a, b) => a - b).slice(-count)
    } finally {
      lock.release()
    }
    if (uids.length === 0) return []
    return this.fetchSummaries(path, uids.join(','), true)
  }

  /**
   * Flag correnti per tutti gli UID >= `fromUid`. Serve a riconciliare la cache:
   * gli UID assenti nella risposta sono stati eliminati sul server.
   */
  async fetchFlags(path: string, fromUid: number): Promise<Map<number, { seen: boolean; flagged: boolean }>> {
    const out = new Map<number, { seen: boolean; flagged: boolean }>()
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    try {
      if (!this.client.mailbox || this.client.mailbox.exists === 0) return out
      for await (const m of this.client.fetch(`${fromUid}:*`, { uid: true, flags: true }, { uid: true })) {
        out.set(m.uid, { seen: !!m.flags?.has('\\Seen'), flagged: !!m.flags?.has('\\Flagged') })
      }
    } finally {
      lock.release()
    }
    return out
  }

  private async fetchSummaries(
    path: string,
    range: string,
    byUid: boolean,
    filter?: (m: FetchMessageObject) => boolean
  ): Promise<MessageSummary[]> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    const raw: FetchMessageObject[] = []
    try {
      if (!this.client.mailbox || this.client.mailbox.exists === 0) return []
      const query = {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        source: { start: 0, maxLength: SNIPPET_SOURCE_BYTES },
        headers: EXTRA_HEADERS
      }
      for await (const m of this.client.fetch(range, query, { uid: byUid })) {
        if (!filter || filter(m)) raw.push(m)
      }
    } finally {
      lock.release()
    }
    return Promise.all(raw.map((m) => this.toSummary(path, m)))
  }

  private async toSummary(folder: string, m: FetchMessageObject): Promise<MessageSummary> {
    const env = m.envelope
    let snippet = ''
    if (m.source) {
      try {
        // Il sorgente è troncato: mailparser è tollerante e ci basta il testo iniziale.
        const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true })
        snippet = makeSnippet(parsed.text || htmlToText(typeof parsed.html === 'string' ? parsed.html : ''))
      } catch {
        snippet = ''
      }
    }
    const date = env?.date ?? (m.internalDate instanceof Date ? m.internalDate : new Date())
    return {
      accountId: this.creds.account.id,
      folder,
      uid: m.uid,
      messageId: env?.messageId ?? null,
      subject: env?.subject || '(nessun oggetto)',
      from: env?.from?.[0] ? toAddress(env.from[0]) : null,
      to: (env?.to ?? []).map(toAddress),
      date: date.getTime(),
      snippet,
      seen: !!m.flags?.has('\\Seen'),
      flagged: !!m.flags?.has('\\Flagged'),
      hasAttachments: hasAttachmentParts(m.bodyStructure),
      ...headerFields(m.headers),
      inReplyTo: env?.inReplyTo ?? headerFields(m.headers).inReplyTo ?? null,
      attachmentNames: attachmentNames(m.bodyStructure).join(' ')
    }
  }

  /** Scarica e analizza il messaggio completo. Le immagini inline (cid:) diventano data URI. */
  /** Scarica il messaggio completo: corpo + contenuto degli allegati (per la cache). */
  async fetchBody(path: string, uid: number): Promise<{ body: MessageBody; files: AttachmentFile[] }> {
    const lock = await this.client.getMailboxLock(path, { readOnly: true })
    let parsed: ParsedMail
    try {
      const dl = await this.client.download(String(uid), undefined, { uid: true })
      if (!dl?.content) throw new Error('Messaggio non trovato')
      parsed = await simpleParser(dl.content)
    } finally {
      lock.release()
    }

    let html = typeof parsed.html === 'string' ? parsed.html : null
    const attachments: AttachmentInfo[] = []
    const files: AttachmentFile[] = []
    for (const a of parsed.attachments) {
      if (a.contentId && html && a.contentType.startsWith('image/')) {
        const cid = a.contentId.replace(/^<|>$/g, '')
        const dataUri = `data:${a.contentType};base64,${a.content.toString('base64')}`
        html = html.split(`cid:${cid}`).join(dataUri)
        if (a.related) continue
      }
      const info = { index: attachments.length, filename: a.filename || 'allegato', contentType: a.contentType, size: a.size }
      attachments.push(info)
      files.push({ ...info, content: a.content })
    }

    const body: MessageBody = {
      accountId: this.creds.account.id,
      folder: path,
      uid,
      html,
      text: parsed.text ?? null,
      cc: flattenAddresses(parsed.cc),
      replyTo: flattenAddresses(parsed.replyTo),
      inReplyTo: parsed.inReplyTo ?? null,
      references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
      attachments
    }
    return { body, files }
  }

  async setSeen(path: string, uids: number[], seen: boolean): Promise<void> {
    await this.withWriteLock(path, async (c) => {
      if (seen) await c.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
      else await c.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
    })
  }

  async setFlagged(path: string, uids: number[], flagged: boolean): Promise<void> {
    await this.withWriteLock(path, async (c) => {
      if (flagged) await c.messageFlagsAdd(uids, ['\\Flagged'], { uid: true })
      else await c.messageFlagsRemove(uids, ['\\Flagged'], { uid: true })
    })
  }

  async move(path: string, uids: number[], destination: string): Promise<void> {
    await this.withWriteLock(path, (c) => c.messageMove(uids, destination, { uid: true }).then(() => undefined))
  }

  /** Eliminazione definitiva (flag \Deleted + EXPUNGE). */
  async deletePermanently(path: string, uids: number[]): Promise<void> {
    await this.withWriteLock(path, (c) => c.messageDelete(uids, { uid: true }).then(() => undefined))
  }

  /** Salva un messaggio grezzo (RFC 822) in una cartella, es. "Inviata". */
  async append(path: string, raw: Buffer, flags: string[] = ['\\Seen']): Promise<void> {
    await this.client.append(path, raw, flags)
  }

  private async withWriteLock(path: string, fn: (c: ImapFlow) => Promise<void>): Promise<void> {
    const lock = await this.client.getMailboxLock(path)
    try {
      await fn(this.client)
    } finally {
      lock.release()
    }
  }

  // ───────────────────────────── IDLE (push) ─────────────────────────────

  /**
   * Apre una seconda connessione che resta su `path` (di solito INBOX).
   * imapflow invia IDLE automaticamente; quando il server notifica nuovi
   * messaggi viene invocato `onChange`.
   */
  async startIdle(path: string, onChange: () => void, onClose: () => void): Promise<void> {
    await this.stopIdle()
    const client = this.createClient(true)
    client.on('exists', (e) => {
      if (e.count > e.prevCount) onChange()
    })
    client.on('expunge', () => onChange())
    client.on('flags', () => onChange())
    client.on('close', onClose)
    await client.connect()
    // NB: niente getMailboxLock qui: imapflow non entra in IDLE finché un lock è tenuto.
    // La cartella resta selezionata e l'auto-IDLE parte dopo `autoIdleDelay`.
    await client.mailboxOpen(path, { readOnly: true })
    this.idle = client
  }

  async stopIdle(): Promise<void> {
    const c = this.idle
    this.idle = null
    if (c) {
      c.removeAllListeners('close')
      await c.logout().catch(() => c.close())
    }
  }
}

// ───────────────────────────── helper ─────────────────────────────

function roleFromSpecialUse(path: string, specialUse?: string): FolderRole {
  if (path.toUpperCase() === 'INBOX') return 'inbox'
  switch (specialUse) {
    case '\\Inbox':
      return 'inbox'
    case '\\Sent':
      return 'sent'
    case '\\Drafts':
      return 'drafts'
    case '\\Trash':
      return 'trash'
    case '\\Junk':
      return 'junk'
    case '\\Archive':
      return 'archive'
    case '\\All':
      return 'all'
    case '\\Flagged':
      return 'flagged'
    default:
      return null
  }
}

function toAddress(a: MessageAddressObject): Address {
  return { name: a.name ?? '', address: a.address ?? '' }
}

function flattenAddresses(v: AddressObject | AddressObject[] | undefined): Address[] {
  if (!v) return []
  const list = Array.isArray(v) ? v : [v]
  return list.flatMap((o) => o.value.map((x) => ({ name: x.name ?? '', address: x.address ?? '' })))
}

interface StructureNode {
  disposition?: string
  type?: string
  parameters?: Record<string, string>
  dispositionParameters?: Record<string, string>
  childNodes?: StructureNode[]
}

/** Nomi dei file allegati letti dalla BODYSTRUCTURE (senza scaricarli). */
export function attachmentNames(node: StructureNode | undefined): string[] {
  if (!node) return []
  const own = node.dispositionParameters?.filename ?? node.parameters?.name
  const mine = own && (node.disposition === 'attachment' || !node.type?.startsWith('text/')) ? [own] : []
  return [...mine, ...(node.childNodes ?? []).flatMap(attachmentNames)]
}

/** Analizza il blocco di header grezzo restituito da FETCH BODY[HEADER.FIELDS (...)]. */
export function parseHeaderBlock(buf: Buffer | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!buf) return out
  // Le righe che iniziano con spazio/tab continuano l'header precedente (folding RFC 5322).
  const unfolded = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    out[key] = out[key] ? `${out[key]} ${line.slice(i + 1).trim()}` : line.slice(i + 1).trim()
  }
  return out
}

function headerFields(buf: Buffer | undefined) {
  const h = parseHeaderBlock(buf)
  const ids = (v?: string) => (v ? v.match(/<[^>]+>/g) ?? [] : [])
  return {
    references: ids(h['references']),
    inReplyTo: ids(h['in-reply-to'])[0] ?? null,
    listUnsubscribe: h['list-unsubscribe'] || null,
    listUnsubscribePost: h['list-unsubscribe-post'] || null,
    listId: h['list-id'] || null,
    precedence: h['precedence']?.toLowerCase() || null,
    autoSubmitted: h['auto-submitted']?.toLowerCase() || null
  }
}

function hasAttachmentParts(node: StructureNode | undefined): boolean {
  if (!node) return false
  if (node.disposition === 'attachment') return true
  return (node.childNodes ?? []).some(hasAttachmentParts)
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
}

function makeSnippet(text: string): string {
  return text
    .replace(/^>.*$/gm, '') // rimuove le righe citate
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SNIPPET_LENGTH)
}
