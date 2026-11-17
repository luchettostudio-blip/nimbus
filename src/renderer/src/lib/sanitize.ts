/**
 * Sanificazione dell'HTML delle email con DOMPurify.
 *
 * - rimuove script, iframe, form, event handler, ecc.
 * - blocca le immagini/risorse esterne (tracking pixel!) finché l'utente non le consente:
 *   gli URL remoti vengono spostati in `data-blocked-src` e rimossi dagli stili inline.
 * - il documento risultante viene mostrato in un iframe sandbox senza script,
 *   con una Content-Security-Policy che vieta comunque le risorse remote se bloccate.
 */
import DOMPurify from 'dompurify'

const REMOTE = /^(https?:)?\/\//i

export interface SanitizeResult {
  html: string
  blockedCount: number
}

export function sanitizeEmail(html: string, allowRemote: boolean): SanitizeResult {
  let blockedCount = 0
  const purifier = DOMPurify()

  purifier.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (!el.getAttribute) return

    if (el.tagName === 'A') {
      el.setAttribute('rel', 'noopener noreferrer')
      el.removeAttribute('target')
    }

    if (!allowRemote) {
      for (const attr of ['src', 'srcset', 'background', 'poster']) {
        const v = el.getAttribute(attr)
        if (v && (REMOTE.test(v.trim()) || attr === 'srcset')) {
          el.setAttribute(`data-blocked-${attr}`, v)
          el.removeAttribute(attr)
          blockedCount++
        }
      }
      const style = el.getAttribute('style')
      if (style && /url\(/i.test(style)) {
        el.setAttribute('style', style.replace(/url\((['"]?)(https?:)?\/\/[^)]*\1\)/gi, 'none'))
        blockedCount++
      }
    }
  })

  const clean = purifier.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base'],
    FORBID_ATTR: ['formaction', 'action'],
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['target']
  }) as unknown as string

  // Rimuove anche gli url() remoti dai blocchi <style>.
  const final = allowRemote ? clean : clean.replace(/url\((['"]?)(https?:)?\/\/[^)]*\1\)/gi, 'none')
  return { html: final, blockedCount }
}

const BASE_STYLE = `
  html,body{margin:0;padding:0;background:#fff;color:#1b1b1f;}
  body{padding:28px 32px;font:14px/1.6 'Segoe UI',system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  a{color:#4a5af0;}
  blockquote{margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ddd;color:#555;}
  pre{white-space:pre-wrap;}
  table{max-width:100% !important;}`

/**
 * Costruisce il documento completo da mettere nello srcdoc dell'iframe,
 * aggiungendo (dopo la sanificazione) una CSP restrittiva e gli stili base.
 */
export function buildEmailDocument(sanitizedHtml: string, allowRemote: boolean): string {
  const imgSrc = allowRemote ? 'data: https: http:' : 'data:'
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:${allowRemote ? ' https:' : ''}`

  const doc = new DOMParser().parseFromString(sanitizedHtml, 'text/html')
  const meta = doc.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = csp
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const style = doc.createElement('style')
  style.textContent = BASE_STYLE
  // La CSP va per prima, gli stili base prima di quelli dell'email (che possono sovrascriverli).
  doc.head.prepend(charset, meta, style)
  return '<!doctype html>' + doc.documentElement.outerHTML
}

/** Converte testo semplice in HTML sicuro, rendendo cliccabili i link. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  return `<pre style="font:inherit;margin:0">${linked}</pre>`
}
