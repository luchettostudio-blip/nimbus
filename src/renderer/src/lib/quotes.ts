/**
 * Separa in una mail il testo "nuovo" da citazioni e firme ripetute,
 * per la vista conversazione (il resto va dietro al pulsante "···").
 */

/** Righe che aprono un blocco citato (client italiani e inglesi più diffusi). */
const QUOTE_START = [
  /^\s*Il giorno .{4,120}(ha scritto|wrote)\s*:?\s*$/i,
  /^\s*Il .{4,80}, .{1,80} ha scritto\s*:?\s*$/i,
  /^\s*On .{4,160} wrote\s*:?\s*$/i,
  /^\s*-{2,}\s*(Messaggio originale|Original Message|Messaggio inoltrato|Forwarded message)\s*-{2,}\s*$/i,
  /^\s*_{10,}\s*$/, // separatore di Outlook
  /^\s*(Da|From)\s*:\s.+$/i // intestazione citata di Outlook (Da: … Inviato: …)
]

export interface SplitText {
  main: string
  hidden: string
}

/**
 * @param knownSignatures firme ripetute dello stesso mittente (rilevate sul thread):
 *        se il testo termina con una di queste, va fra le parti nascoste.
 */
export function splitMessage(text: string, knownSignatures: string[] = []): SplitText {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // Firma standard "-- " (RFC 3676) o blocco di righe citate con ">".
    if (l === '-- ' || l === '--') {
      cut = i
      break
    }
    if (/^\s*>/.test(l) && lines.slice(i).every((x) => /^\s*>/.test(x) || !x.trim())) {
      cut = i
      break
    }
    if (QUOTE_START.some((re) => re.test(l)) && i > 0) {
      cut = i
      break
    }
  }
  let main = lines.slice(0, cut).join('\n').trimEnd()
  let hidden = lines.slice(cut).join('\n').trim()

  for (const sig of knownSignatures) {
    if (sig && main.endsWith(sig) && main.length > sig.length + 2) {
      hidden = `${sig}\n${hidden}`.trim()
      main = main.slice(0, -sig.length).trimEnd()
      break
    }
  }
  return { main: main || text.trim(), hidden: main ? hidden : '' }
}

/**
 * Firme ripetute: le ultime righe (2+) identiche in più messaggi dello stesso mittente.
 * Ritorna, per mittente, il blocco finale in comune.
 */
export function repeatedSignatures(messages: { from: string; text: string }[]): Map<string, string> {
  const bySender = new Map<string, string[][]>()
  for (const m of messages) {
    const lines = m.text.replace(/\r\n/g, '\n').trimEnd().split('\n')
    bySender.set(m.from, [...(bySender.get(m.from) ?? []), lines])
  }
  const out = new Map<string, string>()
  for (const [from, all] of bySender) {
    if (all.length < 2) continue
    let n = 0
    // Quante righe finali sono uguali in tutti i messaggi di questo mittente.
    while (all.every((l) => l.length > n + 1 && l[l.length - 1 - n] === all[0][all[0].length - 1 - n])) n++
    if (n >= 2) out.set(from, all[0].slice(-n).join('\n'))
  }
  return out
}
