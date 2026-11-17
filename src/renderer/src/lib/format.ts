import type { Address } from '@core/models'

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const weekdayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short' })
const dayMonthFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const fullFmt = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
const longFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Data relativa compatta per la lista: 14:32 · Ieri · lun · 12 nov · 12/11/24 */
export function relativeDate(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayMs = 86_400_000
  if (ts >= startOfToday) return timeFmt.format(d)
  if (ts >= startOfToday - dayMs) return 'Ieri'
  if (ts >= startOfToday - 6 * dayMs) return weekdayFmt.format(d)
  if (d.getFullYear() === today.getFullYear()) return dayMonthFmt.format(d)
  return fullFmt.format(d)
}

export function longDate(ts: number): string {
  return longFmt.format(new Date(ts))
}

export function displayName(a: Address | null | undefined): string {
  if (!a) return 'Sconosciuto'
  return a.name || a.address.split('@')[0] || a.address
}

export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address
}

export function initials(a: Address | null | undefined): string {
  const n = displayName(a).replace(/["']/g, '').trim()
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

/** Colore avatar stabile derivato dall'indirizzo. */
export function avatarHue(a: Address | null | undefined): number {
  const s = a?.address || a?.name || '?'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Divide "a@b.it, Mario <c@d.it>" in un array di indirizzi. */
export function parseRecipients(s: string): string[] {
  return s
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
