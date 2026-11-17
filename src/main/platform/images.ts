/**
 * ImageProcessor basato su `nativeImage` di Electron.
 * - ridimensiona a max `maxWidth` px di larghezza (mai ingrandisce)
 * - PNG resta PNG (i loghi hanno spesso la trasparenza), il resto diventa JPEG qualità 85
 */
import { nativeImage } from 'electron'
import type { ImageProcessor } from '../../core/features/signatures/SignatureStore'

const MAX_INPUT_BYTES = 15 * 1024 * 1024

export const nativeImageProcessor: ImageProcessor = {
  async process(data, mime, maxWidth) {
    if (data.length > MAX_INPUT_BYTES) throw new Error('Immagine troppo grande (massimo 15 MB).')
    let img = nativeImage.createFromBuffer(data)
    if (img.isEmpty()) {
      throw new Error('Formato immagine non supportato: usa PNG, JPG, GIF, WebP o BMP.')
    }
    const { width } = img.getSize()
    if (width > maxWidth) {
      img = img.resize({ width: maxWidth, quality: 'best' })
    }
    const size = img.getSize()
    const keepPng = mime === 'image/png' || mime === 'image/gif'
    const out = keepPng ? img.toPNG() : img.toJPEG(85)
    // Un PNG ridimensionato può pesare più di un JPEG: se la foto non ha trasparenza vince il più leggero.
    if (keepPng && out.length > 200 * 1024 && !hasAlpha(img)) {
      const jpeg = img.toJPEG(85)
      if (jpeg.length < out.length) return { data: jpeg, mime: 'image/jpeg', width: size.width, height: size.height }
    }
    return { data: out, mime: keepPng ? 'image/png' : 'image/jpeg', width: size.width, height: size.height }
  }
}

/** true se almeno un pixel non è completamente opaco (bitmap BGRA). */
function hasAlpha(img: Electron.NativeImage): boolean {
  const bmp = img.toBitmap()
  for (let i = 3; i < bmp.length; i += 4) if (bmp[i] < 255) return true
  return false
}
