/**
 * Snooze ("Rimanda").
 *
 *  - snooze: sposta la mail via IMAP in "Nimbus/Rimandate" (creata se manca) e
 *    salva l'orario di risveglio nella tabella `snoozes`. Il riferimento è il
 *    Message-ID, perché dopo ogni spostamento il server assegna un nuovo UID.
 *  - risveglio: la riporta in Posta in arrivo, non letta, in cima (woke_at) con
 *    etichetta "Rimandata", ed emette `snooze-woke` (→ notifica Windows).
 *  - all'avvio le mail scadute mentre l'app era chiusa tornano subito in inbox.
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ImapService } from '../../imap/ImapService'
import type { MailStore } from '../../store/MailStore'
import type { Address, SnoozeItem, SyncEvent } from '../../models'

const MAX_TIMER_MS = 60 * 60 * 1000
const RETRY_MS = 30 * 1000

/** Ciò che lo Snoozer chiede al motore di sync. */
export interface SnoozeHost {
  /** Connessione IMAP comandi dell'account, se connessa. */
  imapFor(accountId: string): ImapService | null
  syncFolder(accountId: string, path: string, notify: boolean): Promise<void>
  removeLocally(accountId: string, folder: string, uids: number[]): void
  emit(e: SyncEvent): void
  /** Il prossimo arrivo di questo Message-ID non deve generare la notifica "nuova mail". */
  suppressNewMailNotification(messageId: string): void
}

interface Row {
  id: string
  account_id: string
  message_id: string
  subject: string
  from_json: string | null
  snippet: string
  original_folder: string
  wake_at: number
  created_at: number
}

export class Snoozer {
  private timer: NodeJS.Timeout | null = null
  private started = false
  private waking = new Set<string>()

  constructor(
    private readonly store: MailStore,
    private readonly host: SnoozeHost
  ) {}

  private get db(): Database.Database {
    return this.store.raw
  }

  start(): void {
    this.started = true
    // Le scadute (app chiusa all'orario previsto) vengono risvegliate subito dal primo giro.
    this.arm(0)
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  list(): SnoozeItem[] {
    return (this.db.prepare('SELECT * FROM snoozes ORDER BY wake_at').all() as Row[]).map(toItem)
  }

  async snooze(accountId: string, folder: string, uid: number, wakeAt: number): Promise<SnoozeItem> {
    const msg = this.store.getMessage(accountId, folder, uid)
    if (!msg) throw new Error('Messaggio non trovato.')
    if (!msg.messageId) throw new Error('Questo messaggio non può essere rimandato (manca il Message-ID).')
    const imap = this.host.imapFor(accountId)
    if (!imap) throw new Error('Account non connesso: riprova tra poco.')

    const snoozePath = await imap.ensureSnoozeFolder()
    await imap.move(folder, [uid], snoozePath)
    this.host.removeLocally(accountId, folder, [uid])

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO snoozes (id, account_id, message_id, subject, from_json, snippet, original_folder, wake_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, accountId, msg.messageId, msg.subject, msg.from ? JSON.stringify(msg.from) : null, msg.snippet, folder, wakeAt, Date.now())
    this.changed()
    return toItem(this.db.prepare('SELECT * FROM snoozes WHERE id = ?').get(id) as Row)
  }

  /** Annulla lo snooze: la mail torna subito in Posta in arrivo. */
  async cancel(id: string): Promise<void> {
    const row = this.db.prepare('SELECT * FROM snoozes WHERE id = ?').get(id) as Row | undefined
    if (!row) return
    await this.wake(row, false)
  }

  private changed(): void {
    this.host.emit({ type: 'snooze' })
    this.arm()
  }

  private arm(forceDelay?: number): void {
    if (!this.started) return
    if (this.timer) clearTimeout(this.timer)
    const next = this.db.prepare('SELECT min(wake_at) AS t FROM snoozes').get() as { t: number | null }
    if (next.t === null) return
    const delay = forceDelay ?? Math.min(Math.max(0, next.t - Date.now()), MAX_TIMER_MS)
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    const due = this.db.prepare('SELECT * FROM snoozes WHERE wake_at <= ? ORDER BY wake_at').all(Date.now()) as Row[]
    let retry = false
    for (const row of due) {
      try {
        const done = await this.wake(row, true)
        if (!done) retry = true
      } catch {
        retry = true
      }
    }
    // Account non ancora connesso (es. all'avvio) o errore di rete: riprova a breve.
    if (retry && this.started) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.tick(), RETRY_MS)
    } else {
      this.arm()
    }
  }

  /** Riporta la mail in Posta in arrivo. Ritorna false se l'account non è connesso. */
  private async wake(row: Row, notify: boolean): Promise<boolean> {
    if (this.waking.has(row.id)) return true
    const imap = this.host.imapFor(row.account_id)
    if (!imap) return false
    const inbox = this.store.findFolderByRole(row.account_id, 'inbox')
    if (!inbox) return false
    this.waking.add(row.id)
    try {
      const snoozePath = await imap.ensureSnoozeFolder()
      const uid = await imap.findByMessageId(snoozePath, row.message_id)
      if (uid !== null) {
        this.host.suppressNewMailNotification(row.message_id)
        await imap.move(snoozePath, [uid], inbox.path)
        const inboxUid = await imap.findByMessageId(inbox.path, row.message_id)
        if (inboxUid !== null) await imap.setSeen(inbox.path, [inboxUid], false)
        await this.host.syncFolder(row.account_id, inbox.path, false)
        this.store.markWoke(row.account_id, inbox.path, row.message_id, Date.now())
        this.host.emit({ type: 'messages', accountId: row.account_id, folder: inbox.path })
        if (notify && inboxUid !== null) {
          this.host.emit({
            type: 'snooze-woke',
            accountId: row.account_id,
            folder: inbox.path,
            uid: inboxUid,
            subject: row.subject,
            from: row.from_json ? (JSON.parse(row.from_json) as Address) : null
          })
        }
      }
      // Se non c'è più (spostata a mano altrove) lo snooze decade comunque.
      this.db.prepare('DELETE FROM snoozes WHERE id = ?').run(row.id)
      this.host.emit({ type: 'snooze' })
      return true
    } finally {
      this.waking.delete(row.id)
    }
  }
}

function toItem(r: Row): SnoozeItem {
  return {
    id: r.id,
    accountId: r.account_id,
    messageId: r.message_id,
    subject: r.subject,
    from: r.from_json ? JSON.parse(r.from_json) : null,
    snippet: r.snippet,
    originalFolder: r.original_folder,
    wakeAt: r.wake_at,
    createdAt: r.created_at
  }
}
