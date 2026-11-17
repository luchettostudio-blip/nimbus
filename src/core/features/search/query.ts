/**
 * Parser della sintassi di ricerca (in italiano) → condizioni per FTS5 e SQL.
 *
 *   da:mario            mittente            a:anna            destinatari
 *   oggetto:fattura     oggetto             "frase esatta"    frase
 *   ha:allegato         con allegati        ha:pdf            allegato .pdf (o altra estensione)
 *   prima:2026-11-01    data <              dopo:2026-10-01   data >=
 *   in:inviata          cartella (ruolo o nome)
 *   non:letto           non lette           è:speciale        con stella
 *   account:luca@…      casella
 *
 * Tutto il resto sono parole cercate ovunque (con prefisso: "fatt" trova "fattura").
 */

export interface ParsedQuery {
  /** Espressione FTS5 MATCH (vuota = nessun vincolo testuale). */
  match: string
  /** Parole libere, per la ricerca sul server. */
  terms: string[]
  from?: string
  to?: string
  hasAttachment?: boolean
  before?: number
  after?: number
  folder?: string
  unread?: boolean
  flagged?: boolean
  account?: string
}

const TOKEN = /(\S+?):"([^"]*)"|(\S+?):(\S+)|"([^"]*)"|(\S+)/g

/** Una stringa come literal FTS5 tra virgolette (le virgolette interne vanno raddoppiate). */
function lit(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

function parseDate(s: string): number | undefined {
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return undefined
  const [y, mo, d] = s.includes('-') ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]
  const t = new Date(Number(y), Number(mo) - 1, Number(d)).getTime()
  return Number.isFinite(t) ? t : undefined
}

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = { match: '', terms: [] }
  const parts: string[] = []
  for (const m of input.matchAll(TOKEN)) {
    const key = (m[1] ?? m[3])?.toLowerCase()
    const value = (m[2] ?? m[4] ?? '').trim()
    if (key !== undefined) {
      switch (key) {
        case 'da':
        case 'from':
          q.from = value
          parts.push(`sender:${lit(value)}*`)
          continue
        case 'a':
        case 'to':
          q.to = value
          parts.push(`recipients:${lit(value)}*`)
          continue
        case 'oggetto':
        case 'subject':
          parts.push(`subject:${lit(value)}*`)
          continue
        case 'ha':
        case 'has':
          if (/^(allegat[oi]|attachment)$/i.test(value)) q.hasAttachment = true
          else parts.push(`attachments:${lit(value.replace(/^\./, ''))}`)
          continue
        case 'prima':
        case 'before':
          q.before = parseDate(value)
          continue
        case 'dopo':
        case 'after':
          q.after = parseDate(value)
          continue
        case 'in':
          q.folder = value
          continue
        case 'non':
          if (/^lett[oae]$/i.test(value)) q.unread = true
          continue
        case 'è':
        case 'e':
        case 'is':
          if (/^speciale|stella|flagged$/i.test(value)) q.flagged = true
          else if (/^non-?lett[oae]|unread$/i.test(value)) q.unread = true
          continue
        case 'account':
        case 'casella':
          q.account = value
          continue
        default:
          // "http://…" e simili: non è un operatore, è testo.
          break
      }
    }
    const phrase = m[5]
    if (phrase !== undefined) {
      if (phrase.trim()) {
        parts.push(lit(phrase.trim()))
        q.terms.push(phrase.trim())
      }
      continue
    }
    const word = (m[6] ?? m[0]).trim()
    if (!word) continue
    // Parola libera con ricerca per prefisso (solo se ha almeno un carattere alfanumerico).
    if (/[\p{L}\p{N}]/u.test(word)) {
      parts.push(`${lit(word)}*`)
      q.terms.push(word)
    }
  }
  q.match = parts.join(' AND ')
  return q
}

/** Toglie un operatore (es. "ha:allegato") dalla query: usato dai chip cliccabili. */
export function removeOperator(input: string, op: string): string {
  const re = new RegExp(`(^|\\s)${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:("[^"]*"|\\S+)`, 'gi')
  return input.replace(re, ' ').replace(/\s+/g, ' ').trim()
}

/** Aggiunge o sostituisce un operatore nella query. */
export function setOperator(input: string, op: string, value: string): string {
  const base = removeOperator(input, op)
  const v = /\s/.test(value) ? `"${value}"` : value
  return `${base} ${op}:${v}`.trim()
}

/** Valore di un operatore presente nella query (per mostrare i chip attivi). */
export function operatorValue(input: string, op: string): string | null {
  const m = input.match(new RegExp(`(?:^|\\s)${op}:("([^"]*)"|(\\S+))`, 'i'))
  return m ? (m[2] ?? m[3]) : null
}
