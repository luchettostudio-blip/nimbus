/** Orari rapidi per invio programmato e snooze (ora locale). */

export interface TimePreset {
  id: string
  label: string
  at: Date
}

function at(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d
}

/** Prossimo lunedì (se oggi è lunedì, quello della settimana dopo). */
function nextMonday(base: Date, hour: number): Date {
  const day = base.getDay() // 0 = domenica
  const offset = ((8 - day) % 7) || 7
  return at(base, offset, hour)
}

export function sendPresets(now = new Date()): TimePreset[] {
  return [
    { id: 'tomorrow-morning', label: 'Domani mattina', at: at(now, 1, 8) },
    { id: 'tomorrow-afternoon', label: 'Domani pomeriggio', at: at(now, 1, 14) },
    { id: 'monday-morning', label: 'Lunedì mattina', at: nextMonday(now, 8) }
  ]
}

export function snoozePresets(now = new Date()): TimePreset[] {
  const later = new Date(now.getTime() + 3 * 60 * 60 * 1000)
  const evening = at(now, 0, 18)
  const list: TimePreset[] = [{ id: 'later', label: 'Più tardi oggi', at: later }]
  // "Stasera" ha senso solo se le 18 devono ancora arrivare.
  if (evening.getTime() > now.getTime() + 15 * 60 * 1000) list.push({ id: 'evening', label: 'Stasera', at: evening })
  list.push({ id: 'tomorrow', label: 'Domani mattina', at: at(now, 1, 9) }, { id: 'monday', label: 'Lunedì prossimo', at: nextMonday(now, 9) })
  return list
}

const fmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatWhen(ts: number | Date): string {
  return fmt.format(typeof ts === 'number' ? new Date(ts) : ts)
}

/** Valore per <input type="datetime-local"> (ora locale). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
