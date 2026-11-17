/**
 * Outbox persistente (tabella `outbox`): un'unica coda per
 *  - ANNULLA INVIO: la mail parte dopo N secondi; nel frattempo si può ritirare.
 *  - INVIO PROGRAMMATO: la mail parte all'orario scelto, anche a finestra chiusa
 *    (il main process resta attivo nella tray).
 *
 * Un solo timer punta alla prossima scadenza. All'avvio:
 *  - i programmati scaduti da più di MISSED_GRACE_MS (PC spento/app chiusa) diventano
 *    'missed': non partono da soli, l'utente decide se inviarli ora;
 *  - gli "annulla invio" rimasti in coda (app chiusa durante la finestra) partono subito,
 *    perché l'utente aveva già premuto Invia.
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { DraftMessage, OutboxItem, OutboxKind, SyncEvent } from '../../models'

const MISSED_GRACE_MS = 2 * 60 * 1000
const RETRY_DELAY_MS = 2 * 60 * 1000
const MAX_ATTEMPTS = 3
/** setTimeout non accetta ritardi oltre ~24,8 giorni: si ricontrolla almeno ogni ora. */
const MAX_TIMER_MS = 60 * 60 * 1000

interface Row {
  id: string
  account_id: string
  payload_json: string
  send_at: number
  kind: OutboxKind
  status: OutboxItem['status']
  error: string | null
  attempts: number
  created_at: number
}

export interface OutboxDeps {
  send(draft: DraftMessage): Promise<void>
  emit(e: SyncEvent): void
}

export class Outbox {
  private timer: NodeJS.Timeout | null = null
  private started = false
  private sending = new Set<string>()

  constructor(
    private readonly db: Database.Database,
    private readonly deps: OutboxDeps
  ) {}

  /** Da chiamare all'avvio, quando gli account sono pronti. */
  start(): void {
    const now = Date.now()
    const missed = this.db
      .prepare(`UPDATE outbox SET status = 'missed' WHERE kind = 'scheduled' AND status = 'pending' AND send_at < ?`)
      .run(now - MISSED_GRACE_MS).changes
    // Un invio interrotto a metà (crash) torna in coda.
    this.db.prepare(`UPDATE outbox SET status = 'pending' WHERE status = 'sending'`).run()
    this.started = true
    if (missed > 0) this.deps.emit({ type: 'outbox-missed', count: this.missedCount() })
    this.arm()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.started = false
  }

  enqueue(draft: DraftMessage, mode: string, kind: OutboxKind, sendAt: number): OutboxItem {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO outbox (id, account_id, payload_json, send_at, kind, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`
      )
      .run(id, draft.accountId, JSON.stringify({ draft, mode }), sendAt, kind, Date.now())
    this.changed()
    return this.get(id)!
  }

  /** Ritira un messaggio non ancora partito. Ritorna null se è già in invio o inviato. */
  cancel(id: string): OutboxItem | null {
    if (this.sending.has(id)) return null
    const item = this.get(id)
    if (!item) return null
    this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
    this.changed()
    return item
  }

  update(id: string, patch: { draft?: DraftMessage; mode?: string; sendAt?: number }): OutboxItem {
    const item = this.get(id)
    if (!item) throw new Error('Messaggio non più in coda (forse è già stato inviato).')
    if (this.sending.has(id)) throw new Error('Il messaggio è in fase di invio.')
    const draft = patch.draft ?? item.draft
    this.db
      .prepare(`UPDATE outbox SET payload_json = ?, account_id = ?, send_at = ?, status = 'pending', error = NULL, attempts = 0 WHERE id = ?`)
      .run(JSON.stringify({ draft, mode: patch.mode ?? item.mode }), draft.accountId, patch.sendAt ?? item.sendAt, id)
    this.changed()
    return this.get(id)!
  }

  /** Invia subito (anche un programmato 'missed' o 'failed'). */
  async sendNow(id: string): Promise<void> {
    this.db.prepare(`UPDATE outbox SET send_at = ?, status = 'pending', error = NULL WHERE id = ?`).run(Date.now(), id)
    await this.fire()
  }

  async sendAllMissed(): Promise<void> {
    this.db.prepare(`UPDATE outbox SET send_at = ?, status = 'pending' WHERE status = 'missed'`).run(Date.now())
    await this.fire()
  }

  /** Programmati, mancati e falliti (gli "annulla invio" sono gestiti dal toast). */
  list(): OutboxItem[] {
    return (this.db.prepare(`SELECT * FROM outbox WHERE kind = 'scheduled' OR status = 'failed' ORDER BY send_at`).all() as Row[]).map(toItem)
  }

  get(id: string): OutboxItem | undefined {
    const r = this.db.prepare('SELECT * FROM outbox WHERE id = ?').get(id) as Row | undefined
    return r ? toItem(r) : undefined
  }

  missedCount(): number {
    return (this.db.prepare(`SELECT count(*) AS c FROM outbox WHERE status = 'missed'`).get() as { c: number }).c
  }

  private changed(): void {
    this.deps.emit({ type: 'outbox' })
    this.arm()
  }

  private arm(): void {
    if (!this.started) return
    if (this.timer) clearTimeout(this.timer)
    const next = this.db.prepare(`SELECT min(send_at) AS t FROM outbox WHERE status = 'pending'`).get() as { t: number | null }
    if (next.t === null) return
    const delay = Math.min(Math.max(0, next.t - Date.now()), MAX_TIMER_MS)
    this.timer = setTimeout(() => void this.fire(), delay)
  }

  private async fire(): Promise<void> {
    const due = (
      this.db.prepare(`SELECT * FROM outbox WHERE status = 'pending' AND send_at <= ? ORDER BY send_at`).all(Date.now() + 250) as Row[]
    ).map(toItem)
    for (const item of due) {
      if (this.sending.has(item.id)) continue
      this.sending.add(item.id)
      this.db.prepare(`UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ?`).run(item.id)
      try {
        await this.deps.send(item.draft)
        this.db.prepare('DELETE FROM outbox WHERE id = ?').run(item.id)
        this.deps.emit({ type: 'outbox-sent', id: item.id, kind: item.kind, subject: item.draft.subject })
      } catch (err) {
        const message = (err as Error)?.message ?? String(err)
        const attempts = item.attempts + 1
        if (item.kind === 'scheduled' && attempts < MAX_ATTEMPTS) {
          // Probabilmente offline: riprova tra poco.
          this.db.prepare(`UPDATE outbox SET status = 'pending', send_at = ?, error = ? WHERE id = ?`).run(Date.now() + RETRY_DELAY_MS, message, item.id)
        } else {
          this.db.prepare(`UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`).run(message, item.id)
          this.deps.emit({ type: 'outbox-failed', id: item.id, kind: item.kind, error: message })
        }
      } finally {
        this.sending.delete(item.id)
      }
    }
    this.deps.emit({ type: 'outbox' })
    this.arm()
  }
}

function toItem(r: Row): OutboxItem {
  const payload = JSON.parse(r.payload_json) as { draft: DraftMessage; mode: string }
  return {
    id: r.id,
    accountId: r.account_id,
    draft: payload.draft,
    mode: payload.mode,
    sendAt: r.send_at,
    kind: r.kind,
    status: r.status,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.created_at
  }
}
