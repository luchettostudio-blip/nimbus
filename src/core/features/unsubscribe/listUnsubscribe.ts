/**
 * Header List-Unsubscribe (RFC 2369) e List-Unsubscribe-Post (RFC 8058).
 * Puro (niente rete): usato sia dal main sia dalla UI per mostrare il metodo.
 */

export type UnsubscribeMethod = 'one-click' | 'mailto' | 'browser'

export interface MailtoTarget {
  to: string
  subject: string
  body: string
}

export interface UnsubscribePlan {
  method: UnsubscribeMethod
  /** URL https (one-click / browser) o indirizzo mailto. */
  target: string
  mailto?: MailtoTarget
}

/** Estrae i valori tra < > dell'header, nell'ordine indicato dal mittente. */
export function parseListUnsubscribe(header: string | null | undefined): { urls: string[]; mailtos: MailtoTarget[] } {
  const urls: string[] = []
  const mailtos: MailtoTarget[] = []
  for (const m of (header ?? '').matchAll(/<\s*([^>]+?)\s*>/g)) {
    const v = m[1].replace(/\s+/g, '')
    if (/^https?:\/\//i.test(v)) urls.push(v)
    else if (/^mailto:/i.test(v)) {
      const [addr, query = ''] = v.slice(7).split('?')
      const params = new URLSearchParams(query)
      const to = decodeURIComponent(addr)
      if (to.includes('@')) mailtos.push({ to, subject: params.get('subject') || 'unsubscribe', body: params.get('body') || 'unsubscribe' })
    }
  }
  return { urls, mailtos }
}

/**
 * Sceglie il metodo, in ordine di preferenza:
 *  1. One-Click (RFC 8058): List-Unsubscribe-Post presente + URL https → POST silenzioso
 *  2. mailto: → mail di disiscrizione inviata in automatico dall'account giusto
 *  3. link → aperto nel browser predefinito
 */
export function planUnsubscribe(listUnsubscribe: string | null | undefined, listUnsubscribePost: string | null | undefined): UnsubscribePlan | null {
  const { urls, mailtos } = parseListUnsubscribe(listUnsubscribe)
  const https = urls.find((u) => /^https:\/\//i.test(u))
  if (https && /List-Unsubscribe\s*=\s*One-Click/i.test(listUnsubscribePost ?? '')) return { method: 'one-click', target: https }
  if (mailtos[0]) return { method: 'mailto', target: mailtos[0].to, mailto: mailtos[0] }
  if (urls[0]) return { method: 'browser', target: urls[0] }
  return null
}
