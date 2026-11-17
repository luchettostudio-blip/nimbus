import { motion } from 'framer-motion'
import { CalendarClock } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatWhen, toLocalInput, type TimePreset } from '../lib/schedule'

/**
 * Menu a comparsa con orari rapidi + data e ora personalizzate.
 * Usato da "Programma invio" e "Rimanda" (snooze).
 */
export function TimeMenu(props: {
  title: string
  presets: TimePreset[]
  onPick: (at: number) => void
  onClose: () => void
  /** Voci extra in fondo (es. "Invia ora"). */
  extra?: ReactNode
  align?: 'left' | 'right'
  placement?: 'up' | 'down'
}) {
  const { title, presets, onPick, onClose, extra, align = 'left', placement = 'up' } = props
  const [custom, setCustom] = useState(false)
  const [value, setValue] = useState(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000)))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const ts = new Date(value).getTime()
  const valid = Number.isFinite(ts) && ts > Date.now() + 30_000

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.12 }}
      className={`absolute z-50 w-64 rounded-xl border border-line bg-elevated p-1.5 shadow-2xl ${placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} ${
        align === 'left' ? 'left-0' : 'right-0'
      }`}
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-faint">{title}</div>
      {presets.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p.at.getTime())}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover"
        >
          <span>{p.label}</span>
          <span className="text-[11.5px] text-muted">{formatWhen(p.at)}</span>
        </button>
      ))}
      {custom ? (
        <div className="space-y-2 px-2.5 py-2">
          <input
            type="datetime-local"
            value={value}
            min={toLocalInput(new Date())}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none [color-scheme:light_dark]"
          />
          <button
            disabled={!valid}
            onClick={() => onPick(ts)}
            className="h-8 w-full rounded-lg bg-accent text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            {valid ? `Conferma · ${formatWhen(ts)}` : 'Scegli un orario futuro'}
          </button>
        </div>
      ) : (
        <button onClick={() => setCustom(true)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover">
          <CalendarClock size={14} className="text-muted" /> Data e ora personalizzate…
        </button>
      )}
      {extra}
    </motion.div>
  )
}
