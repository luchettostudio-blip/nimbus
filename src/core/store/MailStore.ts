/**
 * MailStore — cache locale su SQLite (better-sqlite3, API sincrona e velocissima).
 *
 * La UI legge SEMPRE da qui: all'avvio l'app mostra subito i dati in cache,
 * poi il SyncEngine aggiorna il DB e notifica i cambiamenti.
 *
 * Schema:
 *   accounts (id, json)                         — configurazione account (senza password)
 *   folders  (account_id, path, …)              — cartelle con conteggi e UIDVALIDITY
 *   messages (account_id, folder, uid, …)       — riepiloghi per la lista
 *   bodies   (account_id, folder, uid, json)    — corpi completi scaricati on-demand
 *   kv       (key, value)                       — preferenze varie
 *
 * Le tabelle delle funzioni avanzate (firme, outbox, snooze, FTS, thread…) sono in
 * schema.ts e gestite dai rispettivi repository tramite `store.raw`.
 *
 * Equivalente Swift previsto: GRDB.swift o SwiftData con le stesse tabelle.
 */
import Database from 'better-sqlite3'
import { DEFAULT_SETTINGS, type Account, type AppSettings, type Folder, type InboxCategory, type MessageBody, type MessageSummary } from '../models'
import { MIGRATIONS } from './schema'

interface MessageRow {
  account_id: string
  folder: string
  uid: number
  message_id: string | null
  subject: string
  from_name: string | null
  from_address: string | null
  to_json: string
  date: number
  snippet: string
  seen: number
  flagged: number
  has_attachments: number
  in_reply_to: string | null
  refs: string | null
  thread_id: string | null
  category: string | null
  list_unsubscribe: string | null
  list_unsubscribe_post: string | null
  list_id: string | null
  precedence: string | null
  auto_submitted: string | null
  woke_at: number | null
  attachment_names: string
}

export class MailStore {
  private db: Database.Database

  /** Connessione grezza, per i repository delle funzioni (firme, outbox, ricerca…). */
  get raw(): Database.Database {
    return this.db
  }

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v])
        this.db.pragma(`user_version = ${v + 1}`)
      })()
    }
  }

  // ───────────────────────────── account ─────────────────────────────

  saveAccount(a: Account): void {
    this.db
      .prepare('INSERT INTO accounts (id, json, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
      .run(a.id, JSON.stringify(a), a.createdAt)
  }

  listAccounts(): Account[] {
    return (this.db.prepare('SELECT json FROM accounts ORDER BY created_at').all() as { json: string }[]).map((r) =>
      JSON.parse(r.json)
    )
  }

  getAccount(id: string): Account | undefined {
    const row = this.db.prepare('SELECT json FROM accounts WHERE id = ?').get(id) as { json: string } | undefined
    return row ? JSON.parse(row.json) : undefined
  }

  deleteAccount(id: string): void {
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  }

  // ───────────────────────────── cartelle ─────────────────────────────

  /** Sostituisce l'elenco cartelle dell'account (rimuove quelle sparite dal server). */
  replaceFolders(accountId: string, folders: Folder[]): void {
    const tx = this.db.transaction(() => {
      const keep = new Set(folders.map((f) => f.path))
      const existing = this.db.prepare('SELECT path FROM folders WHERE account_id = ?').all(accountId) as { path: string }[]
      for (const { path } of existing) {
        if (!keep.has(path)) this.clearFolder(accountId, path, true)
      }
      const up = this.db.prepare(`
        INSERT INTO folders (account_id, path, name, role, delimiter, unread, total, uid_validity)
        VALUES (@accountId, @path, @name, @role, @delimiter, @unread, @total, @uidValidity)
        ON CONFLICT(account_id, path) DO UPDATE SET
          name = excluded.name, role = excluded.role, delimiter = excluded.delimiter,
          unread = excluded.unread, total = excluded.total`)
      for (const f of folders) up.run(f)
    })
    tx()
  }

  listFolders(accountId: string): Folder[] {
    return (
      this.db
        .prepare(
          `SELECT account_id AS accountId, path, name, role, delimiter, unread, total, uid_validity AS uidValidity
           FROM folders WHERE account_id = ?`
        )
        .all(accountId) as Folder[]
    ).sort(folderOrder)
  }

  getFolder(accountId: string, path: string): Folder | undefined {
    return this.listFolders(accountId).find((f) => f.path === path)
  }

  findFolderByRole(accountId: string, role: Folder['role']): Folder | undefined {
    return this.listFolders(accountId).find((f) => f.role === role)
  }

  setFolderUidValidity(accountId: string, path: string, uidValidity: number): void {
    this.db.prepare('UPDATE folders SET uid_validity = ? WHERE account_id = ? AND path = ?').run(uidValidity, accountId, path)
  }

  /** Ricalcola il contatore "non lette" dai dati in cache (usato dopo modifiche locali). */
  adjustUnread(accountId: string, path: string, delta: number): void {
    this.db
      .prepare('UPDATE folders SET unread = MAX(0, unread + ?) WHERE account_id = ? AND path = ?')
      .run(delta, accountId, path)
  }

  setFolderCounts(accountId: string, path: string, unread: number, total: number): void {
    this.db.prepare('UPDATE folders SET unread = ?, total = ? WHERE account_id = ? AND path = ?').run(unread, total, accountId, path)
  }

  /** Svuota la cache di una cartella (es. UIDVALIDITY cambiata). */
  clearFolder(accountId: string, path: string, dropFolder = false): void {
    this.db.prepare('DELETE FROM messages WHERE account_id = ? AND folder = ?').run(accountId, path)
    this.db.prepare('DELETE FROM bodies WHERE account_id = ? AND folder = ?').run(accountId, path)
    if (dropFolder) this.db.prepare('DELETE FROM folders WHERE account_id = ? AND path = ?').run(accountId, path)
  }

  // ───────────────────────────── messaggi ─────────────────────────────

  upsertMessages(list: MessageSummary[]): void {
    if (list.length === 0) return
    const stmt = this.db.prepare(`
      INSERT INTO messages (account_id, folder, uid, message_id, subject, from_name, from_address, to_json, date, snippet, seen, flagged,
        has_attachments, in_reply_to, refs, list_unsubscribe, list_unsubscribe_post, list_id, precedence, auto_submitted, attachment_names)
      VALUES (@account_id, @folder, @uid, @message_id, @subject, @from_name, @from_address, @to_json, @date, @snippet, @seen, @flagged,
        @has_attachments, @in_reply_to, @refs, @list_unsubscribe, @list_unsubscribe_post, @list_id, @precedence, @auto_submitted, @attachment_names)
      ON CONFLICT(account_id, folder, uid) DO UPDATE SET
        seen = excluded.seen, flagged = excluded.flagged, snippet = excluded.snippet, subject = excluded.subject,
        in_reply_to = coalesce(excluded.in_reply_to, in_reply_to), refs = coalesce(excluded.refs, refs),
        list_unsubscribe = coalesce(excluded.list_unsubscribe, list_unsubscribe),
        list_unsubscribe_post = coalesce(excluded.list_unsubscribe_post, list_unsubscribe_post),
        list_id = coalesce(excluded.list_id, list_id), precedence = coalesce(excluded.precedence, precedence),
        auto_submitted = coalesce(excluded.auto_submitted, auto_submitted)`)
    const tx = this.db.transaction((rows: MessageSummary[]) => {
      for (const m of rows) stmt.run(toRow(m))
    })
    tx(list)
  }

  /** Le mail tornate da uno snooze contano dall'orario di risveglio: finiscono in cima. */
  listMessages(accountId: string, folder: string, limit = 500, offset = 0): MessageSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE account_id = ? AND folder = ? ORDER BY max(date, coalesce(woke_at, 0)) DESC, uid DESC LIMIT ? OFFSET ?')
      .all(accountId, folder, limit, offset) as MessageRow[]
    return rows.map(fromRow)
  }

  getMessage(accountId: string, folder: string, uid: number): MessageSummary | undefined {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE account_id = ? AND folder = ? AND uid = ?')
      .get(accountId, folder, uid) as MessageRow | undefined
    return row ? fromRow(row) : undefined
  }

  /** Ricerca semplice su oggetto/mittente/anteprima (in un account, o in tutti se accountId è null). */
  searchMessages(accountId: string | null, query: string, limit = 200): MessageSummary[] {
    // "!" come carattere di escape per % e _ (evita le complicazioni delle backslash).
    const q = `%${query.replace(/[!%_]/g, (c) => '!' + c)}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE (? IS NULL OR account_id = ?) AND
           (subject LIKE ? ESCAPE '!' OR from_name LIKE ? ESCAPE '!' OR from_address LIKE ? ESCAPE '!' OR snippet LIKE ? ESCAPE '!')
         ORDER BY date DESC LIMIT ?`
      )
      .all(accountId, accountId, q, q, q, q, limit) as MessageRow[]
    return rows.map(fromRow)
  }

  /** Messaggi delle cartelle "inbox" di tutti gli account, dal più recente. */
  listUnifiedInbox(limit = 2000): MessageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m
         JOIN folders f ON f.account_id = m.account_id AND f.path = m.folder
         WHERE f.role = 'inbox'
         ORDER BY max(m.date, coalesce(m.woke_at, 0)) DESC, m.uid DESC LIMIT ?`
      )
      .all(limit) as MessageRow[]
    return rows.map(fromRow)
  }

  uidRange(accountId: string, folder: string): { min: number; max: number; count: number } {
    const r = this.db
      .prepare('SELECT MIN(uid) AS min, MAX(uid) AS max, COUNT(*) AS count FROM messages WHERE account_id = ? AND folder = ?')
      .get(accountId, folder) as { min: number | null; max: number | null; count: number }
    return { min: r.min ?? 0, max: r.max ?? 0, count: r.count }
  }

  cachedUids(accountId: string, folder: string): number[] {
    return (
      this.db.prepare('SELECT uid FROM messages WHERE account_id = ? AND folder = ?').all(accountId, folder) as { uid: number }[]
    ).map((r) => r.uid)
  }

  setFlags(accountId: string, folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean }): void {
    if (flags.seen !== undefined)
      this.db.prepare('UPDATE messages SET seen = ? WHERE account_id = ? AND folder = ? AND uid = ?').run(+flags.seen, accountId, folder, uid)
    if (flags.flagged !== undefined)
      this.db
        .prepare('UPDATE messages SET flagged = ? WHERE account_id = ? AND folder = ? AND uid = ?')
        .run(+flags.flagged, accountId, folder, uid)
  }

  /** Segna come "tornata da snooze" (etichetta + ordinamento) e non letta. */
  markWoke(accountId: string, folder: string, messageId: string, at: number): void {
    this.db
      .prepare('UPDATE messages SET woke_at = ?, seen = 0 WHERE account_id = ? AND folder = ? AND message_id = ?')
      .run(at, accountId, folder, messageId)
  }

  deleteMessages(accountId: string, folder: string, uids: number[]): void {
    const del = this.db.prepare('DELETE FROM messages WHERE account_id = ? AND folder = ? AND uid = ?')
    const delBody = this.db.prepare('DELETE FROM bodies WHERE account_id = ? AND folder = ? AND uid = ?')
    this.db.transaction(() => {
      for (const uid of uids) {
        del.run(accountId, folder, uid)
        delBody.run(accountId, folder, uid)
      }
    })()
  }

  // ───────────────────────────── corpi ─────────────────────────────

  getBody(accountId: string, folder: string, uid: number): MessageBody | undefined {
    const row = this.db
      .prepare('SELECT json FROM bodies WHERE account_id = ? AND folder = ? AND uid = ?')
      .get(accountId, folder, uid) as { json: string } | undefined
    return row ? JSON.parse(row.json) : undefined
  }

  saveBody(b: MessageBody): void {
    this.db
      .prepare('INSERT OR REPLACE INTO bodies (account_id, folder, uid, json) VALUES (?, ?, ?, ?)')
      .run(b.accountId, b.folder, b.uid, JSON.stringify(b))
  }

  // ───────────────────────────── preferenze ─────────────────────────────

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }

  getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.getSetting<Partial<AppSettings>>('settings', {}) }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch }
    this.setSetting('settings', next)
    return next
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
  }
}

// ───────────────────────────── mapping ─────────────────────────────

function toRow(m: MessageSummary): Omit<MessageRow, 'thread_id' | 'category' | 'woke_at'> {
  return {
    account_id: m.accountId,
    folder: m.folder,
    uid: m.uid,
    message_id: m.messageId,
    subject: m.subject,
    from_name: m.from?.name ?? null,
    from_address: m.from?.address ?? null,
    to_json: JSON.stringify(m.to),
    date: m.date,
    snippet: m.snippet,
    seen: +m.seen,
    flagged: +m.flagged,
    has_attachments: +m.hasAttachments,
    in_reply_to: m.inReplyTo ?? null,
    refs: m.references?.length ? JSON.stringify(m.references) : null,
    list_unsubscribe: m.listUnsubscribe ?? null,
    list_unsubscribe_post: m.listUnsubscribePost ?? null,
    list_id: m.listId ?? null,
    precedence: m.precedence ?? null,
    auto_submitted: m.autoSubmitted ?? null,
    attachment_names: m.attachmentNames ?? ''
  }
}

function fromRow(r: MessageRow): MessageSummary {
  return {
    accountId: r.account_id,
    folder: r.folder,
    uid: r.uid,
    messageId: r.message_id,
    subject: r.subject,
    from: r.from_address || r.from_name ? { name: r.from_name ?? '', address: r.from_address ?? '' } : null,
    to: JSON.parse(r.to_json),
    date: r.date,
    snippet: r.snippet,
    seen: !!r.seen,
    flagged: !!r.flagged,
    hasAttachments: !!r.has_attachments,
    inReplyTo: r.in_reply_to,
    references: r.refs ? JSON.parse(r.refs) : [],
    listUnsubscribe: r.list_unsubscribe,
    listUnsubscribePost: r.list_unsubscribe_post,
    listId: r.list_id,
    precedence: r.precedence,
    autoSubmitted: r.auto_submitted,
    attachmentNames: r.attachment_names,
    threadId: r.thread_id,
    category: (r.category as InboxCategory | null) ?? null,
    wokeAt: r.woke_at
  }
}

/** Converte una riga grezza di `messages` nel modello (per i repository delle funzioni). */
export function messageFromRow(r: unknown): MessageSummary {
  return fromRow(r as MessageRow)
}

const ROLE_ORDER: Record<string, number> = { inbox: 0, flagged: 1, drafts: 2, sent: 3, archive: 4, all: 5, junk: 6, trash: 7 }

function folderOrder(a: Folder, b: Folder): number {
  const ra = a.role ? ROLE_ORDER[a.role] ?? 50 : 100
  const rb = b.role ? ROLE_ORDER[b.role] ?? 50 : 100
  if (ra !== rb) return ra - rb
  return a.path.localeCompare(b.path)
}
