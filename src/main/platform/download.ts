/**
 * Download di immagini remote (firme incollate da altri client) da incorporare come CID.
 * Solo http(s), solo immagini, massimo 15 MB.
 */
import { net } from 'electron'

const MAX_BYTES = 15 * 1024 * 1024

/**
 * Disiscrizione One-Click (RFC 8058): POST con corpo "List-Unsubscribe=One-Click".
 * Solo https, senza cookie né credenziali, timeout di 15 secondi.
 */
export async function postOneClick(url: string): Promise<number> {
  if (!/^https:\/\//i.test(url)) throw new Error('La disiscrizione con un clic richiede un indirizzo https.')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      credentials: 'omit',
      redirect: 'follow',
      signal: ctrl.signal
    })
    return res.status
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? 'Il sito del mittente non risponde.' : `Disiscrizione non riuscita: ${(e as Error).message}`)
  } finally {
    clearTimeout(t)
  }
}

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
