/**
 * Download di immagini remote (firme incollate da altri client) da incorporare come CID.
 * Solo http(s), solo immagini, massimo 15 MB.
 */
import { net } from 'electron'

const MAX_BYTES = 15 * 1024 * 1024

export async function downloadImage(url: string): Promise<{ data: Buffer; mime: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Indirizzo immagine non valido.')
  const res = await net.fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Impossibile scaricare l'immagine (HTTP ${res.status}).`)
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!mime.startsWith('image/')) throw new Error('Il link non punta a un’immagine.')
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > MAX_BYTES) throw new Error('Immagine troppo grande (massimo 15 MB).')
  return { data, mime }
}
