/**
 * Viste sulle conversazioni:
 *  - `collapse`: una riga per conversazione nella lista (la mail più recente della
 *    cartella), con numero di messaggi, non lette e partecipanti su TUTTE le cartelle
 *    (così le mie risposte in "Inviata" contano).
 *  - `get`: tutti i messaggi della conversazione, senza doppioni, per la vista chat.
 */
import type Database from 'better-sqlite3'
import { messageFromRow } from '../../store/MailStore'
import type { Account, MessageSummary } from '../../models'

/** Le cartelle escluse dalla vista conversazione (salvo che la conversazione sia lì). */
const HIDDEN_ROLES = new Set(['trash', 'junk'])
/** Quale copia tenere quando la stessa mail è in più cartelle. */
const ROLE_PRIORITY: Record<string, number> = { inbox: 0, sent: 1, archive: 2, flagged: 3, all: 9 }

export class Threads {
  constructor(
    private readonly db: Database.Database,
    private readonly accounts: () => Account[]
  ) {}

  collapse(list: MessageSummary[]): MessageSummary[] {
    const firstByThread = new Map<string, MessageSummary>()
    const out: MessageSummary[] = []
    for (const m of list) {
      const key = `${m.accountId}|${m.threadId ?? `solo:${m.folder}:${m.uid}`}`
      if (firstByThread.has(key)) continue
      firstByThread.set(key, m)
      out.push(m)
    }

    // Statistiche dei thread su tutte le cartelle, a blocchi per non superare i limiti di SQLite.
    const byAccount = new Map<string, string[]>()
    for (const m of out) if (m.threadId) byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), m.threadId])
    const stats = new Map<string, { ids: Set<string>; unread: Set<string>; people: string[] }>()
    for (const [accountId, ids] of byAccount) {
      const me = this.accounts().find((a) => a.id === accountId)?.email.toLowerCase()
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400)
        const rows = this.db
          .prepare(
            `SELECT m.thread_id, m.message_id, m.folder, m.uid, m.seen, m.from_name, m.from_address, f.role
             FROM messages m LEFT JOIN folders f ON f.account_id = m.account_id AND f.path = m.folder
             WHERE m.account_id = ? AND m.thread_id IN (${chunk.map(() => '?').join(',')}) ORDER BY m.date`
          )
          .all(accountId, ...chunk) as {
          thread_id: string
          message_id: string | null
          folder: string
          uid: number
          seen: number
          from_name: string | null
          from_address: string | null
          role: string | null
        }[]
        for (const r of rows) {
          if (r.role && HIDDEN_ROLES.has(r.role)) continue
          const key = `${accountId}|${r.thread_id}`
          const s = stats.get(key) ?? { ids: new Set(), unread: new Set(), people: [] }
          const id = r.message_id ?? `${r.folder}:${r.uid}`
          s.ids.add(id)
          if (!r.seen) s.unread.add(id)
          const isMe = !!me && r.from_address?.toLowerCase() === me
          const name = isMe ? 'Io' : (r.from_name || r.from_address?.split('@')[0] || '').split(' ')[0]
          if (name && !s.people.includes(name)) s.people.push(name)
          stats.set(key, s)
        }
      }
    }
    for (const m of out) {
      const s = m.threadId ? stats.get(`${m.accountId}|${m.threadId}`) : undefined
      m.threadCount = s ? Math.max(1, s.ids.size) : 1
      m.threadUnread = s ? s.unread.size : m.seen ? 0 : 1
      m.participants = s?.people ?? []
    }
    return out
  }

  /** Messaggi della conversazione in ordine cronologico, una copia per Message-ID. */
  get(accountId: string, threadId: string): MessageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, f.role AS folder_role FROM messages m
         LEFT JOIN folders f ON f.account_id = m.account_id AND f.path = m.folder
         WHERE m.account_id = ? AND m.thread_id = ? ORDER BY m.date`
      )
      .all(accountId, threadId) as (Record<string, unknown> & { folder_role: string | null })[]
    const visible = rows.some((r) => !HIDDEN_ROLES.has(r.folder_role ?? '')) ? rows.filter((r) => !HIDDEN_ROLES.has(r.folder_role ?? '')) : rows
    const best = new Map<string, (typeof rows)[number]>()
    const prio = (r: (typeof rows)[number]) => ROLE_PRIORITY[r.folder_role ?? ''] ?? 5
    for (const r of visible) {
      const id = (r.message_id as string | null) ?? `${r.folder}:${r.uid}`
      const cur = best.get(id)
      if (!cur || prio(r) < prio(cur)) best.set(id, r)
    }
    return [...best.values()].map(messageFromRow).sort((a, b) => a.date - b.date)
  }
}
