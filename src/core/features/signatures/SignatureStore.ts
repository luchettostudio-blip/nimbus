/**
 * Firme per account (tabelle `signatures`, `signature_images`, `account_prefs`).
 *
 * L'HTML salvato referenzia le immagini con `cid:<id>`: al momento dell'invio
 * diventano allegati inline, quindi il logo si vede anche nei client che
 * bloccano le immagini remote. Le immagini arrivano qui già ridimensionate
 * (max 300px) e compresse da un `ImageProcessor` della piattaforma.
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Signature, SignatureImage, SignaturePrefs, SignatureView } from '../../models'

/** Ridimensiona/comprime immagini. Electron: nativeImage. Swift: CoreGraphics/ImageIO. */
export interface ImageProcessor {
  /** Ridimensiona a `maxWidth` (senza ingrandire) e comprime. */
  process(data: Buffer, mime: string, maxWidth: number): Promise<{ data: Buffer; mime: string; width: number; height: number }>
}

export const SIGNATURE_IMAGE_MAX_WIDTH = 300

interface ImageRow {
  cid: string
  signature_id: string | null
  mime: string
  width: number
  height: number
  data: Buffer
}

export class SignatureStore {
  constructor(
    private readonly db: Database.Database,
    private readonly images: ImageProcessor
  ) {}

  list(accountId: string): SignatureView[] {
    const rows = this.db
      .prepare('SELECT id, account_id, name, html, updated_at FROM signatures WHERE account_id = ? ORDER BY name COLLATE NOCASE')
      .all(accountId) as { id: string; account_id: string; name: string; html: string; updated_at: number }[]
    return rows.map((r) => this.toView({ id: r.id, accountId: r.account_id, name: r.name, html: r.html, updatedAt: r.updated_at }))
  }

  get(id: string): Signature | undefined {
    const r = this.db.prepare('SELECT id, account_id, name, html, updated_at FROM signatures WHERE id = ?').get(id) as
      | { id: string; account_id: string; name: string; html: string; updated_at: number }
      | undefined
    return r ? { id: r.id, accountId: r.account_id, name: r.name, html: r.html, updatedAt: r.updated_at } : undefined
  }

  /** Crea o aggiorna. `html` deve già usare `cid:` per le immagini. */
  save(input: { id?: string; accountId: string; name: string; html: string }): SignatureView {
    const id = input.id ?? randomUUID()
    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO signatures (id, account_id, name, html, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, html = excluded.html, updated_at = excluded.updated_at`
        )
        .run(id, input.accountId, input.name.trim() || 'Firma', input.html, now)
      // Collega le immagini usate e rimuove quelle non più referenziate.
      const used = cidsIn(input.html)
      const link = this.db.prepare('UPDATE signature_images SET signature_id = ? WHERE cid = ?')
      for (const cid of used) link.run(id, cid)
      const existing = this.db.prepare('SELECT cid FROM signature_images WHERE signature_id = ?').all(id) as { cid: string }[]
      const del = this.db.prepare('DELETE FROM signature_images WHERE cid = ?')
      for (const { cid } of existing) if (!used.includes(cid)) del.run(cid)

      // La prima firma dell'account diventa predefinita per tutto.
      const prefs = this.getPrefs(input.accountId)
      if (!prefs.newId && !prefs.replyId) this.setPrefs(input.accountId, { newId: id, replyId: id })
    })()
    return this.toView(this.get(id)!)
  }

  delete(id: string): void {
    const sig = this.get(id)
    this.db.prepare('DELETE FROM signatures WHERE id = ?').run(id)
    if (sig) {
      const p = this.getPrefs(sig.accountId)
      this.setPrefs(sig.accountId, { newId: p.newId === id ? null : p.newId, replyId: p.replyId === id ? null : p.replyId })
    }
  }

  getPrefs(accountId: string): SignaturePrefs {
    const r = this.db.prepare('SELECT sig_new_id, sig_reply_id FROM account_prefs WHERE account_id = ?').get(accountId) as
      | { sig_new_id: string | null; sig_reply_id: string | null }
      | undefined
    return { newId: r?.sig_new_id ?? null, replyId: r?.sig_reply_id ?? null }
  }

  setPrefs(accountId: string, prefs: SignaturePrefs): void {
    this.db
      .prepare(
        `INSERT INTO account_prefs (account_id, sig_new_id, sig_reply_id) VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET sig_new_id = excluded.sig_new_id, sig_reply_id = excluded.sig_reply_id`
      )
      .run(accountId, prefs.newId, prefs.replyId)
  }

  /** Elabora un'immagine (ridimensiona + comprime) e la salva in attesa di essere collegata a una firma. */
  async addImage(data: Buffer, mime: string): Promise<SignatureImage> {
    const out = await this.images.process(data, mime, SIGNATURE_IMAGE_MAX_WIDTH)
    const cid = `sig-${randomUUID()}@nimbus`
    this.db
      .prepare('INSERT INTO signature_images (cid, signature_id, mime, width, height, data) VALUES (?, NULL, ?, ?, ?, ?)')
      .run(cid, out.mime, out.width, out.height, out.data)
    return { cid, mime: out.mime, width: out.width, height: out.height, dataUrl: toDataUrl(out.mime, out.data) }
  }

  /** Immagini referenziate dall'HTML di una firma (per gli allegati inline). */
  imagesFor(html: string): { cid: string; mime: string; data: Buffer }[] {
    const get = this.db.prepare('SELECT * FROM signature_images WHERE cid = ?')
    return cidsIn(html).flatMap((cid) => {
      const r = get.get(cid) as ImageRow | undefined
      return r ? [{ cid: r.cid, mime: r.mime, data: r.data }] : []
    })
  }

  private toView(sig: Signature): SignatureView {
    let previewHtml = sig.html
    for (const img of this.imagesFor(sig.html)) {
      previewHtml = previewHtml.split(`src="cid:${img.cid}"`).join(`src="${toDataUrl(img.mime, img.data)}" data-cid="${img.cid}"`)
    }
    return { ...sig, previewHtml }
  }
}

export function cidsIn(html: string): string[] {
  return [...new Set([...html.matchAll(/src=["']cid:([^"']+)["']/gi)].map((m) => m[1]))]
}

function toDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString('base64')}`
}
