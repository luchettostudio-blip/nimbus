/**
 * Raggruppamento in conversazioni (variante incrementale dell'algoritmo JWZ).
 *
 * Ogni mail porta con sé i Message-ID della catena (References + In-Reply-To).
 * La tabella `thread_links` associa ogni Message-ID conosciuto a un thread:
 * quando una mail cita ID già appartenenti a thread diversi, i thread si
 * fondono (è il passo "union" di JWZ, fatto via via che le mail arrivano).
 *
 * Fallback sull'oggetto normalizzato (senza Re:, R:, Fwd:, I:…) SOLO se la mail
 * non ha né References né In-Reply-To: alcuni client non li mettono.
 */
import type Database from 'better-sqlite3'
import type { MessageSummary } from '../../models'
import { messageFromRow } from '../../store/MailStore'

/** Prefissi di risposta/inoltro in varie lingue (anche ripetuti: "Re: R: Fwd:"). */
const PREFIX = /^\s*((re|r|ri|rif|fwd?|fw|i|inoltro|inoltra|aw|wg|sv|vs|tr|antw)(\[\d+\])?\s*:\s*)+/i

export function normalizeSubject(subject: string): string {
  return subject.replace(PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function hasReplyPrefix(subject: string): boolean {
  return PREFIX.test(subject)
}

/** Finestra in cui il fallback per oggetto può agganciare una conversazione. */
const SUBJECT_WINDOW_MS = 60 * 86_400_000

export class Threader {
  constructor(private readonly db: Database.Database) {}

  /** Assegna (o aggiorna) il thread delle mail indicate. */
  assign(messages: MessageSummary[]): void {
    if (messages.length === 0) return
    const tx = this.db.transaction((list: MessageSummary[]) => {
      // Le più vecchie prima: la radice di un thread arriva di solito per prima.
      for (const m of [...list].sort((a, b) => a.date - b.date)) this.assignOne(m)
    })
    tx(messages)
  }

  private assignOne(m: MessageSummary): void {
    const acc = m.accountId
    if (!m.messageId) {
      this.db.prepare('UPDATE messages SET thread_id = ? WHERE account_id = ? AND folder = ? AND uid = ?').run(`solo:${m.folder}:${m.uid}`, acc, m.folder, m.uid)
      return
    }
    const refs = [...(m.references ?? []), ...(m.inReplyTo ? [m.inReplyTo] : [])]
    const ids = [...new Set([m.messageId, ...refs])]

    const getLink = this.db.prepare('SELECT thread_id FROM thread_links WHERE account_id = ? AND message_id = ?')
    const found = new Set<string>()
    for (const id of ids) {
      const r = getLink.get(acc, id) as { thread_id: string } | undefined
      if (r) found.add(r.thread_id)
    }

    let thread: string
    if (found.size > 0) {
      // Più thread collegati dalla stessa mail: si fondono nel più "vecchio" (id minore).
      const [keep, ...merge] = [...found].sort()
      thread = keep
      for (const t of merge) {
        this.db.prepare('UPDATE thread_links SET thread_id = ? WHERE account_id = ? AND thread_id = ?').run(keep, acc, t)
        this.db.prepare('UPDATE messages SET thread_id = ? WHERE account_id = ? AND thread_id = ?').run(keep, acc, t)
      }
    } else if (refs.length === 0 && hasReplyPrefix(m.subject)) {
      // Nessun header di catena: ultimo tentativo con l'oggetto normalizzato.
      thread = this.bySubject(m) ?? m.messageId
    } else {
      // La radice della catena (primo References) identifica il thread anche se non l'abbiamo.
      thread = refs[0] ?? m.messageId
    }

    const link = this.db.prepare('INSERT INTO thread_links (account_id, message_id, thread_id) VALUES (?, ?, ?) ON CONFLICT(account_id, message_id) DO UPDATE SET thread_id = excluded.thread_id')
    for (const id of ids) link.run(acc, id, thread)
    // Tutte le copie della mail (es. Inbox + "Tutti i messaggi" su Gmail).
    this.db.prepare('UPDATE messages SET thread_id = ? WHERE account_id = ? AND message_id = ?').run(thread, acc, m.messageId)
  }

  private bySubject(m: MessageSummary): string | null {
    const norm = normalizeSubject(m.subject)
    if (!norm) return null
    const rows = this.db
      .prepare(
        `SELECT subject, thread_id FROM messages
         WHERE account_id = ? AND thread_id IS NOT NULL AND date BETWEEN ? AND ? AND message_id IS NOT ?
         ORDER BY date DESC LIMIT 400`
      )
      .all(m.accountId, m.date - SUBJECT_WINDOW_MS, m.date + 86_400_000, m.messageId) as { subject: string; thread_id: string }[]
    return rows.find((r) => normalizeSubject(r.subject) === norm)?.thread_id ?? null
  }

  /** Assegna il thread alle mail che non l'hanno ancora (es. dopo la migrazione). */
  backfill(): number {
    const rows = this.db.prepare('SELECT * FROM messages WHERE thread_id IS NULL ORDER BY date').all()
    this.assign(rows.map(messageFromRow))
    return rows.length
  }
}
