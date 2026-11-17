/**
 * Allegati nel renderer: tipo di anteprima e cache in memoria dei byte già scaricati.
 * I byte arrivano dal main (cache su disco), mai da URL remoti.
 */
import type { AttachmentInfo } from '@core/models'
import { call } from './api'

export type PreviewKind = 'image' | 'pdf' | 'text' | 'other'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico)$/i
const TEXT_EXT = /\.(txt|csv|tsv|json|log|md|xml|ya?ml|ini|cfg|conf|ics|vcf|js|ts|css|html?|sql|py|sh|ps1|bat)$/i

export function previewKind(a: Pick<AttachmentInfo, 'filename' | 'contentType'>): PreviewKind {
  const mime = a.contentType.toLowerCase()
  if (mime === 'application/pdf' || /\.pdf$/i.test(a.filename)) return 'pdf'
  if (mime.startsWith('image/') || IMAGE_EXT.test(a.filename)) return 'image'
  if (mime.startsWith('text/') || /json|xml|csv|yaml|javascript/.test(mime) || TEXT_EXT.test(a.filename)) return 'text'
  return 'other'
}

export interface LoadedAttachment {
  data: Uint8Array
  mime: string
  filename: string
  size: number
  /** blob: URL (solo per immagini). */
  url?: string
}

const cache = new Map<string, Promise<LoadedAttachment>>()

export function attachmentKey(accountId: string, folder: string, uid: number, index: number): string {
  return `${accountId}|${folder}|${uid}|${index}`
}

/** Scarica (una volta sola per sessione) i byte di un allegato. */
export function loadAttachment(accountId: string, folder: string, uid: number, info: AttachmentInfo): Promise<LoadedAttachment> {
  const key = attachmentKey(accountId, folder, uid, info.index)
  let p = cache.get(key)
  if (!p) {
    p = call('attachments:get', accountId, folder, uid, info.index).then((r) => {
      const loaded: LoadedAttachment = { ...r }
      if (previewKind(info) === 'image') {
        // Il tipo MIME dichiarato può essere generico: per le immagini si usa quello dell'estensione.
        const mime = r.mime.startsWith('image/') ? r.mime : guessImageMime(info.filename)
        loaded.url = URL.createObjectURL(new Blob([r.data as BlobPart], { type: mime }))
      }
      return loaded
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

function guessImageMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  return (
    { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }[
      ext ?? ''
    ] ?? 'application/octet-stream'
  )
}

/** Testo leggibile da un allegato testuale (JSON indentato). */
export function decodeText(data: Uint8Array, filename: string): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data)
  if (/\.json$/i.test(filename)) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  return text
}
