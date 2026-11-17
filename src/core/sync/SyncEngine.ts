/**
 * SyncEngine — il "cervello" dell'app. Coordina ImapService, SmtpService e
 * MailStore per tutti gli account ed emette `SyncEvent` verso la UI.
 *
 * Principi:
 *  1. CACHE-FIRST: ogni lettura arriva da MailStore (istantanea). Il sync
 *     aggiorna la cache in background e poi notifica con un evento.
 *  2. OTTIMISTICO: le azioni dell'utente (letto, archivia, elimina) modificano
 *     subito la cache e la UI; il server viene aggiornato dopo. In caso di
 *     errore si risincronizza la cartella per tornare allo stato reale.
 *  3. INCREMENTALE: alla prima apertura si scaricano gli ultimi N messaggi;
 *     poi solo quelli con UID maggiore del massimo in cache, più una
 *     riconciliazione leggera dei flag e delle eliminazioni.
 *  4. PUSH: una connessione IDLE su INBOX notifica i nuovi arrivi in tempo reale;
 *     un polling di riserva copre le connessioni IDLE cadute silenziosamente.
 *
 * Indipendente da Electron: riceve un `CredentialStore` astratto. Nella versione
 * SwiftUI diventerà un `@MainActor final class SyncEngine: ObservableObject`
 * (o un actor + AsyncStream di eventi) con la stessa API.
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { htmlToText, ImapService } from '../imap/ImapService'
import { SmtpService } from '../smtp/SmtpService'
import type { MailStore } from '../store/MailStore'
import { MailSetupError } from '../errors'
import { buildOutgoing } from '../compose/buildOutgoing'
import { SignatureStore, type ImageProcessor } from '../features/signatures/SignatureStore'
import { Outbox } from '../features/outbox/Outbox'
import { Snoozer } from '../features/snooze/Snoozer'
import { AttachmentCache, type CachedAttachment } from '../features/attachments/AttachmentCache'
import { SearchService } from '../features/search/SearchService'
import { Threader } from '../features/threads/Threader'
import { Threads } from '../features/threads/Threads'
import { Classifier } from '../features/classify/Classifier'
import { Unsubscriber } from '../features/unsubscribe/Unsubscriber'
import { messageFromRow } from '../store/MailStore'
import type { Account, DraftMessage, Folder, InboxCategory, MessageBody, MessageSummary, NewAccountInput, OutgoingMessage, SyncEvent } from '../models'

/** Astrazione (asincrona) del portachiavi: in Electron safeStorage/DPAPI, in Swift il Keychain. */
export interface CredentialStore {
  get(accountId: string): Promise<string | null>
  set(accountId: string, password: string): Promise<void>
  delete(accountId: string): Promise<void>
}

const INITIAL_FETCH = 150
const OLDER_PAGE = 100
const POLL_INTERVAL_MS = 3 * 60 * 1000
const MAX_BACKOFF_MS = 60 * 1000

/** Stato runtime di un account connesso. */
class AccountSession {
  imap: ImapService
  reconnectTimer: NodeJS.Timeout | null = null
  pollTimer: NodeJS.Timeout | null = null
  backoff = 2000
  stopped = false
  /** Code per cartella: evita sync concorrenti sulla stessa cartella. */
  queues = new Map<string, Promise<unknown>>()

  constructor(
    public account: Account,
    public password: string
  ) {
    this.imap = new ImapService({ account, password })
  }

  enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(job)
    this.queues.set(key, next)
    return next
  }
}

/** Servizi forniti dalla piattaforma (Electron oggi, Swift domani). */
export interface PlatformServices {
  images: ImageProcessor
  /** Cartella dati dell'app (cache allegati, ecc.). */
  dataDir: string
  /** POST One-Click di disiscrizione (RFC 8058). Ritorna lo status HTTP. */
  postOneClick?(url: string): Promise<number>
  /** Apre un link nel browser predefinito. */
  openExternal?(url: string): Promise<void>
}

export class SyncEngine extends EventEmitter {
  private sessions = new Map<string, AccountSession>()
  /** Message-ID che rientrano in inbox per conto di Nimbus (snooze): niente notifica "nuova mail". */
  private quietMessageIds = new Set<string>()
  readonly signatures: SignatureStore
  readonly outbox: Outbox
  readonly snoozer: Snoozer
  readonly attachments: AttachmentCache
  readonly search: SearchService
  readonly threader: Threader
  readonly threads: Threads
  readonly classifier: Classifier
  readonly unsubscriber: Unsubscriber
  private unsubTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: MailStore,
    private readonly credentials: CredentialStore,
    platform: PlatformServices
  ) {
    super()
    this.signatures = new SignatureStore(store.raw, platform.images)
    this.attachments = new AttachmentCache(store.raw, join(platform.dataDir, 'attachments'))
    this.threader = new Threader(store.raw)
    this.threads = new Threads(store.raw, () => this.store.listAccounts())
    this.classifier = new Classifier(store.raw, () => this.store.listAccounts(), (id) => this.store.findFolderByRole(id, 'sent')?.path)
    this.unsubscriber = new Unsubscriber(store, {
      post: (url) => (platform.postOneClick ? platform.postOneClick(url) : Promise.reject(new Error('POST non disponibile'))),
      openExternal: (url) => (platform.openExternal ? platform.openExternal(url) : Promise.resolve()),
      send: (msg) => this.send(msg),
      archive: (id, folder, uids) => this.archive(id, folder, uids),
      trash: (id, folder, uids) => this.trash(id, folder, uids),
      emit: (e) => this.emitEvent(e)
    })
    // Ogni mail salvata (sync, ricerca, snooze…) viene subito agganciata alla sua
    // conversazione, classificata per l'inbox divisa e, se il mittente è bloccato,
    // spostata nel Cestino.
    store.onUpsert((list) => {
      this.threader.assign(list)
      this.classifier.apply(list)
      this.trashBlocked(list)
    })
    this.threader.backfill()
    this.classifier.backfill(
      (store.raw.prepare('SELECT * FROM messages WHERE category IS NULL').all() as unknown[]).map(messageFromRow)
    )
    this.search = new SearchService(store, {
      accounts: () => this.store.listAccounts(),
      imapFor: (id) => {
        const s = this.sessions.get(id)
        return s?.imap.isConnected ? s.imap : null
      },
      indexMonths: () => this.store.getSettings().indexMonths,
      emit: (e) => this.emitEvent(e)
    })
    this.outbox = new Outbox(store.raw, { send: (d) => this.sendDraft(d), emit: (e) => this.emitEvent(e) })
    this.snoozer = new Snoozer(store, {
      imapFor: (id) => {
        const s = this.sessions.get(id)
        return s?.imap.isConnected ? s.imap : null
      },
      syncFolder: (id, path, notify) => this.syncFolder(id, path, notify),
      removeLocally: (id, folder, uids) => this.removeLocally(id, folder, uids),
      emit: (e) => this.emitEvent(e),
      suppressNewMailNotification: (messageId) => {
        this.quietMessageIds.add(messageId)
        setTimeout(() => this.quietMessageIds.delete(messageId), 2 * 60 * 1000)
      }
    })
  }

  private emitEvent(e: SyncEvent): void {
    this.emit('event', e)
  }

  onEvent(listener: (e: SyncEvent) => void): () => void {
    this.on('event', listener)
    return () => this.off('event', listener)
  }

  // ───────────────────────────── account ─────────────────────────────

  listAccounts(): Account[] {
    return this.store.listAccounts()
  }

  /** Verifica IMAP + SMTP, salva l'account e la password cifrata, avvia il sync. */
  async addAccount(input: NewAccountInput): Promise<Account> {
    const email = input.email.trim()
    if (this.store.listAccounts().some((a) => a.email.toLowerCase() === email.toLowerCase())) {
      throw new MailSetupError('imap', 'unknown', 'Account già presente', `${email} è già stato aggiunto.`)
    }
    const account: Account = {
      id: randomUUID(),
      email,
      displayName: (input.displayName ?? '').trim(),
      username: (input.username || email).trim(),
      imap: input.imap,
      smtp: input.smtp,
      smtpFallbacks: input.smtpFallbacks,
      providerId: input.providerId,
      saveSentCopy: input.saveSentCopy ?? true,
      createdAt: Date.now()
    }
    // IMAP e SMTP in parallelo: la verifica richiede pochi secondi anche con un fallback.
    // Se falliscono entrambi si mostra prima l'errore IMAP.
    const [imap, smtp] = await Promise.allSettled([
      ImapService.testConnection({ account, password: input.password }),
      new SmtpService(account, input.password).verify()
    ])
    if (imap.status === 'rejected') throw imap.reason
    if (smtp.status === 'rejected') throw smtp.reason

    this.store.saveAccount(account)
    await this.credentials.set(account.id, input.password)
    void this.startAccount(account)
    return account
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.stopAccount(accountId)
    this.store.deleteAccount(accountId)
    await this.credentials.delete(accountId)
  }

  /** Avvia il sync di tutti gli account salvati (chiamato all'avvio dell'app). */
  async startAll(): Promise<void> {
    await Promise.all(this.store.listAccounts().map((a) => this.startAccount(a)))
    this.outbox.start()
    this.snoozer.start()
    this.search.schedule()
    // Chi scrive ancora 7 giorni dopo la disiscrizione: proposta di blocco.
    this.unsubscriber.checkStillSending()
    if (this.unsubTimer) clearInterval(this.unsubTimer)
    this.unsubTimer = setInterval(() => this.unsubscriber.checkStillSending(), 60 * 60 * 1000)
  }

  /** Mittenti bloccati: le loro nuove mail in Posta in arrivo vanno nel Cestino. */
  private trashBlocked(list: MessageSummary[]): void {
    const byFolder = new Map<string, { accountId: string; folder: string; uids: number[] }>()
    for (const m of list) {
      if (!m.from?.address || !this.unsubscriber.isBlocked(m.accountId, m.from.address)) continue
      if (this.store.findFolderByRole(m.accountId, 'inbox')?.path !== m.folder) continue
      const k = `${m.accountId}|${m.folder}`
      const e = byFolder.get(k) ?? { accountId: m.accountId, folder: m.folder, uids: [] }
      e.uids.push(m.uid)
      byFolder.set(k, e)
    }
    for (const e of byFolder.values()) {
      // Dopo l'upsert in corso, non dentro la transazione.
      setTimeout(() => void this.trash(e.accountId, e.folder, e.uids).catch(() => {}), 0)
    }
  }

  async stopAll(): Promise<void> {
    this.outbox.stop()
    this.snoozer.stop()
    this.search.stop()
    if (this.unsubTimer) clearInterval(this.unsubTimer)
    await Promise.all([...this.sessions.keys()].map((id) => this.stopAccount(id)))
  }

  private async startAccount(account: Account): Promise<void> {
    const password = await this.credentials.get(account.id)
    if (!password) {
      this.emitEvent({ type: 'status', accountId: account.id, state: 'error', error: 'Password mancante' })
      return
    }
    await this.stopAccount(account.id)
    const s = new AccountSession(account, password)
    this.sessions.set(account.id, s)
    await this.connectSession(s)
  }

  private async stopAccount(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId)
    if (!s) return
    s.stopped = true
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
    if (s.pollTimer) clearInterval(s.pollTimer)
    this.sessions.delete(accountId)
    await s.imap.disconnect().catch(() => {})
  }

  private async connectSession(s: AccountSession): Promise<void> {
    const id = s.account.id
    try {
      this.emitEvent({ type: 'status', accountId: id, state: 'connecting' })
      await s.imap.connect(() => this.handleDisconnect(s))
      s.backoff = 2000

      this.emitEvent({ type: 'status', accountId: id, state: 'syncing' })
      await this.refreshFolders(id)
      const inbox = this.store.findFolderByRole(id, 'inbox')
      if (inbox) {
        await this.syncFolder(id, inbox.path, false)
        await s.imap.startIdle(
          inbox.path,
          () => void this.syncFolder(id, inbox.path, true).catch(() => {}),
          () => this.handleDisconnect(s)
        )
      }
      // Le mie risposte (Inviata) servono alle conversazioni e a "chi ho scritto io".
      const sent = this.store.findFolderByRole(id, 'sent')
      if (sent) void this.syncFolder(id, sent.path, false).catch(() => {})

      if (s.pollTimer) clearInterval(s.pollTimer)
      s.pollTimer = setInterval(() => void this.poll(s), POLL_INTERVAL_MS)
      this.emitEvent({ type: 'status', accountId: id, state: 'idle' })
    } catch (err) {
      this.emitEvent({ type: 'status', accountId: id, state: 'error', error: errorMessage(err) })
      this.handleDisconnect(s)
    }
  }

  /** Riconnessione con backoff esponenziale. */
  private handleDisconnect(s: AccountSession): void {
    if (s.stopped || s.reconnectTimer) return
    this.emitEvent({ type: 'status', accountId: s.account.id, state: 'offline' })
    const delay = s.backoff
    s.backoff = Math.min(s.backoff * 2, MAX_BACKOFF_MS)
    s.reconnectTimer = setTimeout(async () => {
      s.reconnectTimer = null
      if (s.stopped) return
      await s.imap.disconnect().catch(() => {})
      await this.connectSession(s)
    }, delay)
  }

  private async poll(s: AccountSession): Promise<void> {
    if (!s.imap.isConnected) return
    try {
      await this.refreshFolders(s.account.id)
      const inbox = this.store.findFolderByRole(s.account.id, 'inbox')
      if (inbox) await this.syncFolder(s.account.id, inbox.path, true)
      const sent = this.store.findFolderByRole(s.account.id, 'sent')
      if (sent) await this.syncFolder(s.account.id, sent.path, false)
    } catch {
      /* il prossimo giro riproverà */
    }
  }

  /** Riconnette subito tutti gli account offline (es. al ritorno dalla sospensione). */
  reconnectAll(): void {
    for (const s of this.sessions.values()) {
      if (!s.imap.isConnected) {
        if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
        s.reconnectTimer = null
        s.backoff = 1000
        this.handleDisconnect(s)
      }
    }
  }

  private session(accountId: string): AccountSession {
    const s = this.sessions.get(accountId)
    if (!s) throw new Error('Account non attivo')
    return s
  }

  // ───────────────────────────── letture (dalla cache) ─────────────────────────────

  listFolders(accountId: string): Folder[] {
    return this.store.listFolders(accountId)
  }

  /**
   * Lista della cartella; con i thread attivi una riga per conversazione.
   * `category` filtra la Posta in arrivo per scheda (Persone / Newsletter / Notifiche).
   */
  listMessages(accountId: string, folder: string, category?: InboxCategory | null): MessageSummary[] {
    let list = this.store.listMessages(accountId, folder, 5000)
    if (category && this.store.getSettings().splitInbox) list = list.filter((m) => (m.category ?? 'people') === category)
    return this.store.getSettings().threads ? this.threads.collapse(list) : list
  }

  /** Non lette per scheda nelle Posta in arrivo (di un account o di tutti). */
  inboxCounts(accountId: string | null): Record<InboxCategory, number> {
    const rows = this.store.raw
      .prepare(
        `SELECT coalesce(m.category, 'people') AS c, count(*) AS n FROM messages m
         JOIN folders f ON f.account_id = m.account_id AND f.path = m.folder
         WHERE f.role = 'inbox' AND m.seen = 0 AND (? IS NULL OR m.account_id = ?) GROUP BY c`
      )
      .all(accountId, accountId) as { c: InboxCategory; n: number }[]
    const out: Record<InboxCategory, number> = { people: 0, newsletter: 0, notifications: 0 }
    for (const r of rows) out[r.c] = r.n
    return out
  }

  /** Sposta un mittente in un'altra scheda (e lo ricorda). */
  moveSender(accountId: string, address: string, category: InboxCategory): number {
    const n = this.classifier.learn(accountId, address, category)
    this.emitEvent({ type: 'messages', accountId, folder: this.store.findFolderByRole(accountId, 'inbox')?.path ?? 'INBOX' })
    return n
  }

  /** Conversazione completa (tutte le cartelle, comprese le mie risposte in Inviata). */
  getThread(accountId: string, threadId: string): MessageSummary[] {
    return this.threads.get(accountId, threadId)
  }

  /** Ricerca full-text con operatori (vedi features/search/query.ts). */
  searchMessages(query: string): MessageSummary[] {
    return this.search.query(query)
  }

  /** Inbox unificata: le Posta in arrivo di tutti gli account, per data. */
  listUnifiedInbox(category?: InboxCategory | null): MessageSummary[] {
    let list = this.store.listUnifiedInbox(2000)
    if (category && this.store.getSettings().splitInbox) list = list.filter((m) => (m.category ?? 'people') === category)
    return this.store.getSettings().threads ? this.threads.collapse(list) : list
  }

  /** La cartella Posta in arrivo di ogni account (per i contatori della sidebar). */
  listInboxes(): Folder[] {
    return this.store.listAccounts().flatMap((a) => {
      const inbox = this.store.findFolderByRole(a.id, 'inbox')
      return inbox ? [inbox] : []
    })
  }

  /** Sincronizza la Posta in arrivo di tutti gli account connessi. */
  async syncAllInboxes(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map(async (id) => {
        const inbox = this.store.findFolderByRole(id, 'inbox')
        if (inbox) await this.syncFolder(id, inbox.path, false).catch(() => {})
      })
    )
  }

  // ───────────────────────────── sync ─────────────────────────────

  async refreshFolders(accountId: string): Promise<void> {
    const s = this.session(accountId)
    const folders = await s.imap.listFolders()
    this.store.replaceFolders(accountId, folders)
    this.emitEvent({ type: 'folders', accountId })
  }

  /**
   * Sincronizza una cartella. Se `notify` è true, i nuovi messaggi non letti
   * generano un evento `new-mail` (usato per le notifiche native).
   */
  syncFolder(accountId: string, path: string, notify: boolean): Promise<void> {
    const s = this.session(accountId)
    return s.enqueue(path, async () => {
      const { imap } = s
      const state = await imap.folderState(path)
      const cachedFolder = this.store.getFolder(accountId, path)
      if (cachedFolder && cachedFolder.uidValidity && cachedFolder.uidValidity !== state.uidValidity) {
        this.store.clearFolder(accountId, path)
      }
      this.store.setFolderUidValidity(accountId, path, state.uidValidity)

      const range = this.store.uidRange(accountId, path)
      let fresh: MessageSummary[]
      if (range.count === 0) {
        fresh = await imap.fetchLatest(path, INITIAL_FETCH)
      } else {
        fresh = await imap.fetchNewerThan(path, range.max)
        // Riconciliazione: flag cambiati e messaggi eliminati altrove.
        const flags = await imap.fetchFlags(path, range.min)
        const removed: number[] = []
        for (const uid of this.store.cachedUids(accountId, path)) {
          const f = flags.get(uid)
          if (!f) removed.push(uid)
          else this.store.setFlags(accountId, path, uid, f)
        }
        this.store.deleteMessages(accountId, path, removed)
      }
      this.store.upsertMessages(fresh)

      const counts = await imap.status(path)
      this.store.setFolderCounts(accountId, path, counts.unread, counts.total)

      this.emitEvent({ type: 'messages', accountId, folder: path })
      this.emitEvent({ type: 'folders', accountId })

      const unseenNew = fresh.filter(
        (m) => !m.seen && !(m.messageId && this.quietMessageIds.has(m.messageId)) && !(m.from && this.unsubscriber.isBlocked(m.accountId, m.from.address))
      )
      if (notify && range.count > 0 && unseenNew.length > 0) {
        this.emitEvent({ type: 'new-mail', accountId, folder: path, messages: unseenNew })
      }
    })
  }

  /** Carica una pagina di messaggi più vecchi (scroll infinito). Ritorna quanti ne ha aggiunti. */
  async loadOlder(accountId: string, path: string): Promise<number> {
    const s = this.session(accountId)
    return s.enqueue(path, async () => {
      const { min } = this.store.uidRange(accountId, path)
      if (min <= 1) return 0
      const older = await s.imap.fetchOlderThan(path, min, OLDER_PAGE)
      this.store.upsertMessages(older)
      if (older.length) this.emitEvent({ type: 'messages', accountId, folder: path })
      return older.length
    })
  }

  // ───────────────────────────── corpo messaggio ─────────────────────────────

  async getBody(accountId: string, folder: string, uid: number): Promise<MessageBody> {
    const cached = this.store.getBody(accountId, folder, uid)
    if (cached) return cached
    const { body, files } = await this.session(accountId).imap.fetchBody(folder, uid)
    this.attachments.save(accountId, folder, uid, files)
    this.store.saveBody(body)
    // Corpo completo appena scaricato: l'indice passa dai primi KB al testo intero.
    const text = (body.text || htmlToText(body.html ?? '')).replace(/\s+/g, ' ').trim()
    if (text) this.store.indexBody(accountId, folder, uid, text.slice(0, 100_000))
    return body
  }

  /** Allegato dalla cache locale; se manca lo riscarica dal server. */
  async getAttachment(accountId: string, folder: string, uid: number, index: number): Promise<CachedAttachment> {
    const hit = this.attachments.get(accountId, folder, uid, index)
    if (hit) return hit
    const { body, files } = await this.session(accountId).imap.fetchBody(folder, uid)
    this.attachments.save(accountId, folder, uid, files)
    this.store.saveBody(body)
    const again = this.attachments.get(accountId, folder, uid, index)
    if (!again) throw new Error('Allegato non trovato o troppo grande per l’anteprima.')
    return again
  }

  // ───────────────────────────── azioni ─────────────────────────────

  async setSeen(accountId: string, folder: string, uids: number[], seen: boolean): Promise<void> {
    let delta = 0
    for (const uid of uids) {
      const m = this.store.getMessage(accountId, folder, uid)
      if (m && m.seen !== seen) delta += seen ? -1 : 1
      this.store.setFlags(accountId, folder, uid, { seen })
    }
    this.store.adjustUnread(accountId, folder, delta)
    this.emitEvent({ type: 'messages', accountId, folder })
    this.emitEvent({ type: 'folders', accountId })
    await this.remote(accountId, folder, (s) => s.imap.setSeen(folder, uids, seen))
  }

  async setFlagged(accountId: string, folder: string, uids: number[], flagged: boolean): Promise<void> {
    for (const uid of uids) this.store.setFlags(accountId, folder, uid, { flagged })
    this.emitEvent({ type: 'messages', accountId, folder })
    await this.remote(accountId, folder, (s) => s.imap.setFlagged(folder, uids, flagged))
  }

  /** Archivia: sposta nella cartella Archivio (Gmail: "Tutti i messaggi"). La crea se manca. */
  async archive(accountId: string, folder: string, uids: number[]): Promise<void> {
    const s = this.session(accountId)
    let target = this.store.findFolderByRole(accountId, 'archive') ?? this.store.findFolderByRole(accountId, 'all')
    if (!target) {
      await s.imap.createFolder('Archive')
      await this.refreshFolders(accountId)
      target = this.store.getFolder(accountId, 'Archive')
    }
    if (!target || target.path === folder) return
    const dest = target.path
    this.removeLocally(accountId, folder, uids)
    await this.remote(accountId, folder, (sess) => sess.imap.move(folder, uids, dest))
  }

  /** Elimina: sposta nel Cestino; se si è già nel Cestino (o non esiste) elimina definitivamente. */
  async trash(accountId: string, folder: string, uids: number[]): Promise<void> {
    const trash = this.store.findFolderByRole(accountId, 'trash')
    this.removeLocally(accountId, folder, uids)
    if (!trash || trash.path === folder) {
      await this.remote(accountId, folder, (s) => s.imap.deletePermanently(folder, uids))
    } else {
      await this.remote(accountId, folder, (s) => s.imap.move(folder, uids, trash.path))
    }
  }

  removeLocally(accountId: string, folder: string, uids: number[]): void {
    this.attachments.remove(accountId, folder, uids)
    const unread = uids.filter((uid) => this.store.getMessage(accountId, folder, uid)?.seen === false).length
    this.store.deleteMessages(accountId, folder, uids)
    this.store.adjustUnread(accountId, folder, -unread)
    this.emitEvent({ type: 'messages', accountId, folder })
    this.emitEvent({ type: 'folders', accountId })
  }

  /** Esegue un'operazione sul server; se fallisce, riallinea la cache con il server e rilancia. */
  private async remote(accountId: string, folder: string, op: (s: AccountSession) => Promise<void>): Promise<void> {
    const s = this.session(accountId)
    try {
      await op(s)
    } catch (err) {
      void this.syncFolder(accountId, folder, false).catch(() => {})
      throw err
    }
  }

  /** Compone la bozza (firma + citazione) e la invia. */
  async sendDraft(draft: DraftMessage): Promise<void> {
    await this.send(this.composeDraft(draft))
    // Chi ricevo una mia mail diventa "Persone".
    this.classifier.addContacts(draft.accountId, [...draft.to, ...draft.cc, ...draft.bcc])
  }

  /** Bozza → messaggio MIME con firma (immagini CID) sopra il testo citato. */
  composeDraft(draft: DraftMessage): OutgoingMessage {
    const sig = draft.signatureId ? this.signatures.get(draft.signatureId) : undefined
    return buildOutgoing(draft, sig ? { html: sig.html, images: this.signatures.imagesFor(sig.html) } : null)
  }

  async send(msg: OutgoingMessage): Promise<void> {
    const s = this.session(msg.accountId)
    const smtp = new SmtpService(s.account, s.password)
    const { raw } = await smtp.send(msg)
    await this.saveSentCopy(s, raw)
  }

  /**
   * Dopo l'invio SMTP salva sempre una copia in "Inviata" con IMAP APPEND
   * (Register.it e la maggior parte dei provider non lo fanno da soli),
   * tranne per gli account marcati `saveSentCopy: false` (Gmail, Outlook).
   */
  private async saveSentCopy(s: AccountSession, raw: Buffer): Promise<void> {
    const accountId = s.account.id
    const legacyAutoSave = /gmail|googlemail|outlook|office365|hotmail|live\.com/.test(s.account.smtp.host.toLowerCase())
    const shouldAppend = s.account.saveSentCopy ?? !legacyAutoSave
    let sent = this.store.findFolderByRole(accountId, 'sent')
    if (shouldAppend) {
      if (!sent) {
        // Nessuna cartella "Inviata" marcata dal server: la crea.
        await s.imap.createFolder('Sent').catch(() => {})
        await this.refreshFolders(accountId).catch(() => {})
        sent = this.store.findFolderByRole(accountId, 'sent') ?? this.store.getFolder(accountId, 'Sent')
      }
      if (sent) await s.imap.append(sent.path, raw).catch(() => {})
    }
    if (sent) void this.syncFolder(accountId, sent.path, false).catch(() => {})
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { responseText?: string; message?: string }
    return e.responseText || e.message || String(err)
  }
  return String(err)
}
