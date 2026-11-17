/**
 * Ricerca istantanea full-text (SQLite FTS5) + indicizzazione in background.
 *
 * Indice `messages_fts` (rowid = rowid di `messages`): mittente, destinatari,
 * oggetto, corpo (testo estratto anche dall'HTML) e nomi degli allegati.
 * Il corpo arriva gratis dal sync (primi KB già scaricati per l'anteprima) e
 * diventa completo quando la mail viene aperta.
 *
 * L'indicizzatore scarica in background, a piccoli lotti, le mail degli ultimi
 * N mesi non ancora in cache, senza bloccare la UI, ed emette `index-progress`.
 */
import type { ImapService } from '../../imap/ImapService'
import type { MailStore } from '../../store/MailStore'
import { messageFromRow } from '../../store/MailStore'
import type { Account, IndexStatus, MessageSummary, SyncEvent } from '../../models'
import { parseQuery, type ParsedQuery } from './query'

export interface SearchHost {
  accounts(): Account[]
  imapFor(accountId: string): ImapService | null
  indexMonths(): number
  emit(e: SyncEvent): void
}

const BATCH = 40
const PAUSE_MS = 120
const RESULT_LIMIT = 300

/** Parole italiane/inglesi per `in:` → ruolo della cartella. */
const FOLDER_ROLE: Record<string, string> = {
  inbox: 'inbox', posta: 'inbox', arrivo: 'inbox', 'posta-in-arrivo': 'inbox',
  inviata: 'sent', inviati: 'sent', inviate: 'sent', sent: 'sent',
  archivio: 'archive', archiviate: 'archive', archive: 'archive',
  cestino: 'trash', eliminati: 'trash', trash: 'trash',
  spam: 'junk', junk: 'junk', indesiderata: 'junk',
  bozze: 'drafts', drafts: 'drafts', speciali: 'flagged'
}

export class SearchService {
  private running = false
  private status: IndexStatus = { running: false, done: 0, total: 0 }
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: MailStore,
    private readonly host: SearchHost
  ) {}

  // ───────────────────────────── query locale ─────────────────────────────

  query(input: string): MessageSummary[] {
    const p = parseQuery(input)
    const where: string[] = []
    const args: unknown[] = []
    this.addFilters(p, where, args)

    const db = this.store.raw
    let rows: Record<string, unknown>[]
    if (p.match) {
      const sql = `
        SELECT m.*, highlight(messages_fts, 2, char(2), char(3)) AS hl_subject,
               snippet(messages_fts, 3, char(2), char(3), '…', 16) AS hl_body
        FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH ? ${where.length ? 'AND ' + where.join(' AND ') : ''}
        ORDER BY m.date DESC LIMIT ${RESULT_LIMIT}`
      try {
        rows = db.prepare(sql).all(p.match, ...args) as Record<string, unknown>[]
      } catch {
        return [] // espressione non valida mentre si scrive
      }
    } else if (where.length) {
      rows = db.prepare(`SELECT m.* FROM messages m WHERE ${where.join(' AND ')} ORDER BY m.date DESC LIMIT ${RESULT_LIMIT}`).all(...args) as Record<
        string,
        unknown
      >[]
    } else {
      return []
    }

    // Gmail mette la stessa mail anche in "Tutti i messaggi": un risultato per Message-ID.
    const seen = new Set<string>()
    const out: MessageSummary[] = []
    for (const r of rows) {
      const m = messageFromRow(r)
      const key = m.messageId ? `${m.accountId}|${m.messageId}` : `${m.accountId}|${m.folder}|${m.uid}`
      if (seen.has(key)) continue
      seen.add(key)
      if (r.hl_subject !== undefined) m.highlight = { subject: String(r.hl_subject), snippet: String(r.hl_body ?? '') }
      out.push(m)
    }
    return out
  }

  private addFilters(p: ParsedQuery, where: string[], args: unknown[]): void {
    if (p.hasAttachment) where.push('m.has_attachments = 1')
    if (p.before !== undefined) (where.push('m.date < ?'), args.push(p.before))
    if (p.after !== undefined) (where.push('m.date >= ?'), args.push(p.after))
    if (p.unread) where.push('m.seen = 0')
    if (p.flagged) where.push('m.flagged = 1')
    if (p.account) {
      const ids = this.host
        .accounts()
        .filter((a) => a.email.toLowerCase().includes(p.account!.toLowerCase()) || a.displayName.toLowerCase().includes(p.account!.toLowerCase()))
        .map((a) => a.id)
      where.push(ids.length ? `m.account_id IN (${ids.map(() => '?').join(',')})` : '0')
      args.push(...ids)
    }
    if (p.folder) {
      const role = FOLDER_ROLE[p.folder.toLowerCase()]
      where.push(
        `EXISTS (SELECT 1 FROM folders f WHERE f.account_id = m.account_id AND f.path = m.folder AND (f.role = ? OR f.name LIKE ? OR f.path LIKE ?))`
      )
      args.push(role ?? '__none__', `%${p.folder}%`, `%${p.folder}%`)
    }
  }

  // ───────────────────────────── ricerca sul server ─────────────────────────────

  /**
   * IMAP SEARCH nelle cartelle principali per ciò che non è nell'indice locale.
   * Le mail trovate vengono scaricate e indicizzate; ritorna quante sono nuove.
   */
  async searchServer(input: string): Promise<number> {
    const p = parseQuery(input)
    const terms = [...p.terms, ...(p.from ? [p.from] : []), ...(p.to ? [p.to] : [])]
    if (terms.length === 0) return 0
    let added = 0
    for (const acc of this.host.accounts()) {
      if (p.account && !acc.email.toLowerCase().includes(p.account.toLowerCase())) continue
      const imap = this.host.imapFor(acc.id)
      if (!imap) continue
      const folders = this.store
        .listFolders(acc.id)
        .filter((f) => (p.folder ? f.name.toLowerCase().includes(p.folder.toLowerCase()) || f.role === FOLDER_ROLE[p.folder.toLowerCase()] : ['inbox', 'sent', 'archive', 'all'].includes(f.role ?? '')))
      for (const f of folders) {
        const uids = (await imap.searchText(f.path, terms)).slice(0, 200)
        const missing = this.store.uidsNeedingIndex(acc.id, f.path, uids).slice(0, 100)
        for (let i = 0; i < missing.length; i += BATCH) {
          const list = await imap.fetchByUids(f.path, missing.slice(i, i + BATCH))
          this.store.upsertMessages(list)
          added += list.length
        }
        if (missing.length) this.host.emit({ type: 'messages', accountId: acc.id, folder: f.path })
      }
    }
    return added
  }

  // ───────────────────────────── indicizzazione in background ─────────────────────────────

  getStatus(): IndexStatus {
    return { ...this.status }
  }

  /** Avvia ora e poi ogni 30 minuti. */
  schedule(initialDelayMs = 15_000): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      await this.runIndexing().catch(() => {})
      this.schedule(30 * 60_000)
    }, initialDelayMs)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async runIndexing(): Promise<void> {
    if (this.running) return
    this.running = true
    const months = this.host.indexMonths()
    const since = new Date(Date.now() - months * 30 * 86_400_000)
    try {
      // 1) Piano: cosa manca in ogni cartella (rapido, solo SEARCH).
      const plan: { accountId: string; folder: string; uids: number[]; imap: ImapService }[] = []
      for (const acc of this.host.accounts()) {
        const imap = this.host.imapFor(acc.id)
        if (!imap) continue
        for (const f of this.store.listFolders(acc.id)) {
          if (f.role === 'trash' || f.role === 'junk' || /(^|[./])Nimbus([./]|$)/.test(f.path)) continue
          const uids = await imap.searchSince(f.path, since).catch(() => [] as number[])
          const missing = this.store.uidsNeedingIndex(acc.id, f.path, uids)
          if (missing.length) plan.push({ accountId: acc.id, folder: f.path, uids: missing, imap })
        }
      }
      const total = plan.reduce((n, p) => n + p.uids.length, 0)
      this.setStatus({ running: total > 0, done: 0, total })
      if (total === 0) return

      // 2) Download a piccoli lotti, dal più recente, con pause per lasciare spazio alla UI.
      let done = 0
      for (const item of plan) {
        for (let i = 0; i < item.uids.length; i += BATCH) {
          if (!this.host.imapFor(item.accountId)) break
          const list = await item.imap.fetchByUids(item.folder, item.uids.slice(i, i + BATCH)).catch(() => [] as MessageSummary[])
          this.store.upsertMessages(list)
          done += Math.min(BATCH, item.uids.length - i)
          this.setStatus({ running: true, done, total })
          await new Promise((r) => setTimeout(r, PAUSE_MS))
        }
        this.host.emit({ type: 'messages', accountId: item.accountId, folder: item.folder })
      }
      this.setStatus({ running: false, done: total, total })
    } finally {
      this.running = false
      if (this.status.running) this.setStatus({ ...this.status, running: false })
    }
  }

  private setStatus(s: IndexStatus): void {
    this.status = s
    this.host.emit({ type: 'index-progress', ...s })
  }
}
