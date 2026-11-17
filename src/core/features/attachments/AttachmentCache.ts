/**
 * Cache locale degli allegati (file su disco + tabella `attachment_cache`).
 *
 * Gli allegati vengono scritti quando si apre il messaggio (il corpo completo è
 * già stato scaricato in quel momento), poi l'anteprima legge dal disco senza
 * tornare sul server. Se un file manca (pulizia manuale), il motore lo riscarica.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

export interface AttachmentFile {
  index: number
  filename: string
  contentType: string
  size: number
  content: Buffer
}

export interface CachedAttachment {
  index: number
  filename: string
  mime: string
  size: number
  path: string
}

/** Limite per singolo file in cache (oltre, si legge comunque ma non si salva). */
const MAX_CACHE_BYTES = 100 * 1024 * 1024

export class AttachmentCache {
  constructor(
    private readonly db: Database.Database,
    private readonly baseDir: string
  ) {}

  private dirFor(accountId: string, folder: string, uid: number): string {
    const folderKey = createHash('sha1').update(folder).digest('hex').slice(0, 16)
    return join(this.baseDir, accountId, folderKey, String(uid))
  }

  save(accountId: string, folder: string, uid: number, files: AttachmentFile[]): void {
    if (files.length === 0) return
    const dir = this.dirFor(accountId, folder, uid)
    mkdirSync(dir, { recursive: true })
    const up = this.db.prepare(
      `INSERT OR REPLACE INTO attachment_cache (account_id, folder, uid, idx, filename, mime, size, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const f of files) {
      if (f.content.length > MAX_CACHE_BYTES) continue
      const path = join(dir, `${f.index}-${safeName(f.filename)}`)
      writeFileSync(path, f.content)
      up.run(accountId, folder, uid, f.index, f.filename, f.contentType, f.size, path)
    }
  }

  get(accountId: string, folder: string, uid: number, index: number): CachedAttachment | undefined {
    const r = this.db
      .prepare('SELECT idx, filename, mime, size, path FROM attachment_cache WHERE account_id = ? AND folder = ? AND uid = ? AND idx = ?')
      .get(accountId, folder, uid, index) as { idx: number; filename: string; mime: string; size: number; path: string } | undefined
    if (!r || !existsSync(r.path)) return undefined
    return { index: r.idx, filename: r.filename, mime: r.mime, size: r.size, path: r.path }
  }

  /** Rimuove i file di messaggi eliminati/spostati. */
  remove(accountId: string, folder: string, uids: number[]): void {
    const del = this.db.prepare('DELETE FROM attachment_cache WHERE account_id = ? AND folder = ? AND uid = ?')
    for (const uid of uids) {
      del.run(accountId, folder, uid)
      rmSync(this.dirFor(accountId, folder, uid), { recursive: true, force: true })
    }
  }
}

/** Nome file sicuro per il filesystem di Windows. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120)
  return cleaned || 'allegato'
}
