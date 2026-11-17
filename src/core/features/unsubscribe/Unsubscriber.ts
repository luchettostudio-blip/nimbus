/**
 * Disiscrizione con un clic, lista delle disiscrizioni, mittenti bloccati e
 * vista "Gestisci iscrizioni".
 *
 * Dopo 7 giorni da una disiscrizione, se quel mittente scrive ancora viene
 * emesso `unsub-still-sending` per proporre il blocco (spostamento automatico
 * nel Cestino delle sue mail future).
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { MailStore } from '../../store/MailStore'
import type { OutgoingMessage, Subscription, SyncEvent, Unsubscription } from '../../models'
import { planUnsubscribe, type UnsubscribePlan } from './listUnsubscribe'

const GRACE_MS = 7 * 86_400_000

export interface UnsubscribeHost {
  /** POST One-Click (solo https). Ritorna lo status HTTP. */
  post(url: string): Promise<number>
  openExternal(url: string): Promise<void>
  send(msg: OutgoingMessage): Promise<void>
  archive(accountId: string, folder: string, uids: number[]): Promise<void>
  trash(accountId: string, folder: string, uids: number[]): Promise<void>
  emit(e: SyncEvent): void
}

export class Unsubscriber {
  constructor(
    private readonly store: MailStore,
    private readonly host: UnsubscribeHost
  ) {}

  private get db(): Database.Database {
    return this.store.raw
  }

  /** Ultima mail del mittente con List-Unsubscribe (fonte di header e nome). */
  private latestFrom(accountId: string, address: string) {
    return this.db
      .prepare(
        `SELECT from_name, list_unsubscribe, list_unsubscribe_post, list_id FROM messages
         WHERE account_id = ? AND lower(from_address) = ? AND list_unsubscribe IS NOT NULL ORDER BY date DESC LIMIT 1`
      )
      .get(accountId, address.toLowerCase()) as
      | { from_name: string | null; list_unsubscribe: string; list_unsubscribe_post: string | null; list_id: string | null }
      | undefined
  }

  plan(accountId: string, address: string): UnsubscribePlan | null {
    const m = this.latestFrom(accountId, address)
    return m ? planUnsubscribe(m.list_unsubscribe, m.list_unsubscribe_post) : null
  }

  /**
   * Esegue la disiscrizione dal mittente. Con `archiveAll` archivia anche tutte le sue
   * mail presenti in Posta in arrivo.
   */
  async unsubscribe(accountId: string, address: string, archiveAll: boolean): Promise<{ method: UnsubscribePlan['method']; target: string }> {
    const addr = address.toLowerCase()
    const latest = this.latestFrom(accountId, addr)
    const plan = latest ? planUnsubscribe(latest.list_unsubscribe, latest.list_unsubscribe_post) : null
    if (!plan) throw new Error('Questo mittente non indica come disiscriversi.')

    if (plan.method === 'one-click') {
      const status = await this.host.post(plan.target)
      if (status < 200 || status >= 300) {
        throw new Error(`Il mittente ha risposto con un errore (HTTP ${status}). Riprova più tardi o usa il link nella mail.`)
      }
    } else if (plan.method === 'mailto') {
      const m = plan.mailto!
      await this.host.send({ accountId, to: [m.to], cc: [], bcc: [], subject: m.subject, text: m.body })
    } else {
      await this.host.openExternal(plan.target)
    }

    this.db
      .prepare(
        `INSERT INTO unsubscriptions (id, account_id, address, name, list_id, method, target, created_at, prompted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(randomUUID(), accountId, addr, latest?.from_name ?? null, latest?.list_id ?? null, plan.method, plan.target, Date.now())

    if (archiveAll) await this.archiveFrom(accountId, addr)
    this.host.emit({ type: 'unsubscriptions' })
    return { method: plan.method, target: plan.target }
  }

  private async archiveFrom(accountId: string, addr: string): Promise<void> {
    const inbox = this.store.findFolderByRole(accountId, 'inbox')
    if (!inbox) return
    const uids = (
      this.db.prepare('SELECT uid FROM messages WHERE account_id = ? AND folder = ? AND lower(from_address) = ?').all(accountId, inbox.path, addr) as {
        uid: number
      }[]
    ).map((r) => r.uid)
    if (uids.length) await this.host.archive(accountId, inbox.path, uids)
  }

  list(): Unsubscription[] {
    const rows = this.db
      .prepare(
        `SELECT u.*, (SELECT 1 FROM blocked_senders b WHERE b.account_id = u.account_id AND b.address = u.address) AS blocked,
                (SELECT count(*) FROM messages m WHERE m.account_id = u.account_id AND lower(m.from_address) = u.address AND m.date > u.created_at + ?) AS after,
                coalesce(u.name, (SELECT max(from_name) FROM messages m WHERE m.account_id = u.account_id AND lower(m.from_address) = u.address)) AS name
         FROM unsubscriptions u ORDER BY u.created_at DESC`
      )
      .all(GRACE_MS) as {
      id: string
      account_id: string
      address: string
      list_id: string | null
      method: Unsubscription['method']
      target: string
      created_at: number
      prompted: number
      blocked: number | null
      after: number
      name: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      address: r.address,
      name: r.name,
      method: r.method,
      createdAt: r.created_at,
      blocked: !!r.blocked,
      stillSending: r.after > 0
    }))
  }

  /** Mittenti che continuano a scrivere 7 giorni dopo la disiscrizione: si propone il blocco (una volta). */
  checkStillSending(): void {
    for (const u of this.list()) {
      if (u.blocked || !u.stillSending) continue
      const row = this.db.prepare('SELECT prompted FROM unsubscriptions WHERE id = ?').get(u.id) as { prompted: number }
      if (row.prompted) continue
      this.db.prepare('UPDATE unsubscriptions SET prompted = 1 WHERE id = ?').run(u.id)
      this.host.emit({ type: 'unsub-still-sending', id: u.id, accountId: u.accountId, address: u.address, name: u.name })
    }
  }

  async block(accountId: string, address: string): Promise<void> {
    const addr = address.toLowerCase()
    this.db.prepare('INSERT OR IGNORE INTO blocked_senders (account_id, address, created_at) VALUES (?, ?, ?)').run(accountId, addr, Date.now())
    // Anche le mail già arrivate in Posta in arrivo finiscono nel Cestino.
    const inbox = this.store.findFolderByRole(accountId, 'inbox')
    if (inbox) {
      const uids = (
        this.db.prepare('SELECT uid FROM messages WHERE account_id = ? AND folder = ? AND lower(from_address) = ?').all(accountId, inbox.path, addr) as {
          uid: number
        }[]
      ).map((r) => r.uid)
      if (uids.length) await this.host.trash(accountId, inbox.path, uids)
    }
    this.host.emit({ type: 'unsubscriptions' })
  }

  unblock(accountId: string, address: string): void {
    this.db.prepare('DELETE FROM blocked_senders WHERE account_id = ? AND address = ?').run(accountId, address.toLowerCase())
    this.host.emit({ type: 'unsubscriptions' })
  }

  isBlocked(accountId: string, address: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM blocked_senders WHERE account_id = ? AND address = ?').get(accountId, address.toLowerCase())
  }

  /** "Gestisci iscrizioni": mittenti con List-Unsubscribe, quante mail al mese, stato. */
  subscriptions(accountId: string | null): Subscription[] {
    const monthAgo = Date.now() - 30 * 86_400_000
    const rows = this.db
      .prepare(
        `SELECT m.account_id, lower(m.from_address) AS address, max(m.from_name) AS name, count(*) AS total,
                sum(m.date >= ?) AS month, max(m.date) AS last, min(m.date) AS first,
                (SELECT 1 FROM unsubscriptions u WHERE u.account_id = m.account_id AND u.address = lower(m.from_address)) AS unsub,
                (SELECT 1 FROM blocked_senders b WHERE b.account_id = m.account_id AND b.address = lower(m.from_address)) AS blocked
         FROM messages m
         WHERE m.list_unsubscribe IS NOT NULL AND (? IS NULL OR m.account_id = ?)
         GROUP BY m.account_id, lower(m.from_address)
         ORDER BY month DESC, total DESC`
      )
      .all(monthAgo, accountId, accountId) as {
      account_id: string
      address: string
      name: string | null
      total: number
      month: number
      last: number
      first: number
      unsub: number | null
      blocked: number | null
    }[]
    const out = rows.map((r) => {
      // Media mensile sull'intervallo osservato (almeno un mese), più realistica del solo ultimo mese.
      const months = Math.max(1, (r.last - r.first) / (30 * 86_400_000))
      return {
        accountId: r.account_id,
        address: r.address,
        name: r.name,
        perMonth: Math.max(r.month, Math.round(r.total / months)),
        total: r.total,
        lastAt: r.last,
        unsubscribed: !!r.unsub,
        blocked: !!r.blocked,
        method: this.plan(r.account_id, r.address)?.method ?? null
      }
    })
    // Disiscrizioni di mittenti le cui mail non sono più in cache (es. archiviate tutte).
    const known = new Set(out.map((s) => `${s.accountId}|${s.address}`))
    for (const u of this.list()) {
      if ((accountId && u.accountId !== accountId) || known.has(`${u.accountId}|${u.address}`)) continue
      out.push({
        accountId: u.accountId,
        address: u.address,
        name: u.name,
        perMonth: 0,
        total: 0,
        lastAt: u.createdAt,
        unsubscribed: true,
        blocked: u.blocked,
        method: u.method
      })
    }
    return out
  }
}
