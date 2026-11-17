/**
 * Pipeline HTML delle firme, pensata per Gmail e Outlook:
 *
 *  1. `inlineStyles`   — rende l'HTML incollato in un iframe nascosto e copia gli
 *                        stili calcolati (anche quelli dei blocchi <style>) come
 *                        attributi `style` inline; poi elimina <style>, class, id.
 *  2. `sanitizeSignature` — DOMPurify con una whitelist ristretta (niente script,
 *                        form, iframe, CSS esterno, event handler).
 *  3. `toEmailCompatible` — <p> → <div style="margin:0">, immagini con width/border,
 *                        link colorati inline, tutto dentro una tabella di layout.
 *
 * Le immagini nell'editor sono data URI con `data-cid`; al salvataggio diventano `cid:`.
 */
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'div', 'p', 'br', 'img', 'font', 'small', 'big', 'hr',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'sup', 'sub', 'center'
]
const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'color', 'size', 'face', 'align', 'valign',
  'cellpadding', 'cellspacing', 'border', 'bgcolor', 'colspan', 'rowspan', 'role', 'data-cid', 'data-nimbus-sig'
]

/** Proprietà copiate inline dagli stili calcolati. */
const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height'] as const

export function sanitizeSignature(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|cid:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i
  }) as string
}

/**
 * Copia gli stili calcolati come `style` inline (così le regole dei blocchi <style>
 * e delle classi sopravvivono in Gmail/Outlook, che le ignorano o le rimuovono).
 */
export function inlineStyles(html: string): Promise<string> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-same-origin')
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;height:400px;visibility:hidden;'
    // Niente richieste di rete durante il calcolo: gli src vengono messi da parte.
    const safe = html.replace(/\s(src|srcset|background)=/gi, ' data-orig-$1=').replace(/<link[^>]*>/gi, '')
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222222;">${safe}</body></html>`
    iframe.onload = () => {
      const doc = iframe.contentDocument!
      const win = iframe.contentWindow!
      const all = Array.from(doc.body.querySelectorAll<HTMLElement>('*'))
      // Calcola tutto prima di modificare, altrimenti le modifiche alterano i calcoli successivi.
      const computed = all.map((el) => {
        const cs = win.getComputedStyle(el)
        const parent = el.parentElement ? win.getComputedStyle(el.parentElement) : null
        const decl: string[] = []
        for (const p of INHERITED) {
          const v = cs.getPropertyValue(p)
          if (v && (!parent || parent.getPropertyValue(p) !== v)) decl.push(`${p}:${v}`)
        }
        const deco = cs.getPropertyValue('text-decoration-line')
        if (deco && deco !== 'none' && el.tagName !== 'A') decl.push(`text-decoration:${deco}`)
        const bg = cs.getPropertyValue('background-color')
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') decl.push(`background-color:${bg}`)
        const align = cs.getPropertyValue('text-align')
        if (cs.display === 'block' && align && align !== 'start' && align !== 'left') decl.push(`text-align:${align}`)
        return decl.join(';')
      })
      all.forEach((el, i) => {
        if (computed[i]) el.setAttribute('style', computed[i])
        el.removeAttribute('class')
        el.removeAttribute('id')
      })
      doc.querySelectorAll('style, script, link, meta').forEach((n) => n.remove())
      const out = doc.body.innerHTML.replace(/\sdata-orig-(src|srcset|background)=/gi, ' $1=')
      iframe.remove()
      resolve(out)
    }
    document.body.appendChild(iframe)
  })
}

// Nessun colore forzato: il testo senza colore esplicito segue il tema del client (leggibile anche in dark mode).
const WRAP_STYLE = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;'

/** Rende la firma robusta per Gmail/Outlook: tabella di layout, stili inline, niente <p> con margini. */
export function toEmailCompatible(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const body = doc.body

  // Se è già stata impacchettata, lavora sul contenuto interno (evita tabelle annidate a ogni salvataggio).
  const wrapped = body.querySelector('table[data-nimbus-sig] > tbody > tr > td, table[data-nimbus-sig] > tr > td')
  const root: HTMLElement = (wrapped as HTMLElement) ?? body

  root.querySelectorAll('p').forEach((p) => {
    const div = doc.createElement('div')
    div.innerHTML = p.innerHTML
    div.setAttribute('style', `margin:0;${p.getAttribute('style') ?? ''}`)
    p.replaceWith(div)
  })
  root.querySelectorAll('img').forEach((img) => {
    const w = img.getAttribute('width') ?? (img.style.width ? parseInt(img.style.width) : null)
    if (w) img.setAttribute('width', String(Math.min(300, Number(w))))
    img.setAttribute('border', '0')
    img.setAttribute('style', `border:0;outline:none;text-decoration:none;max-width:300px;height:auto;${(img.getAttribute('style') ?? '').replace(/max-width:[^;]+;?/g, '')}`)
    if (!img.getAttribute('alt')) img.setAttribute('alt', '')
  })
  root.querySelectorAll('a').forEach((a) => {
    const st = a.getAttribute('style') ?? ''
    if (!/color\s*:/.test(st)) a.setAttribute('style', `color:#1a56db;${st}`)
  })

  const inner = root.innerHTML.trim()
  return (
    `<table data-nimbus-sig="1" role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
    `<tr><td style="${WRAP_STYLE}">${inner}</td></tr></table>`
  )
}

/** HTML dell'editor (data URI + data-cid) → HTML da salvare (cid:). */
export function editorToStored(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('img[data-cid]').forEach((img) => {
    img.setAttribute('src', `cid:${img.getAttribute('data-cid')}`)
    img.removeAttribute('data-cid')
  })
  return doc.body.innerHTML
}

/** Immagini da incorporare: remote (http) o data URI senza cid. */
export function pendingImages(html: string): { el: string; src: string }[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return Array.from(doc.querySelectorAll('img'))
    .filter((img) => !img.getAttribute('data-cid'))
    .map((img) => ({ el: img.outerHTML, src: img.getAttribute('src') ?? '' }))
    .filter((x) => /^(https?:|data:image\/)/i.test(x.src))
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}
