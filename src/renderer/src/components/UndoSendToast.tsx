import { AnimatePresence, motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore, type PendingSend } from '../store'

/** Toast in basso "Invio in corso… Annulla" con conto alla rovescia, uno per ogni invio in attesa. */
export function UndoSendToasts() {
  const pending = useStore((s) => s.pendingSends)
  return (
    <div className="pointer-events-none flex flex-col items-center gap-2">
      <AnimatePresence>
        {pending.map((p) => (
          <UndoToast key={p.id} pending={p} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function UndoToast({ pending }: { pending: PendingSend }) {
  const undo = useStore((s) => s.undoSend)
  const total = useStore((s) => s.settings?.undoSendSeconds ?? 10) * 1000
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])

  const left = Math.max(0, pending.sendAt - now)
  const seconds = Math.ceil(left / 1000)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
      className="pointer-events-auto relative flex w-[340px] items-center gap-3 overflow-hidden rounded-xl border border-line bg-elevated px-4 py-2.5 text-[13px] shadow-xl"
    >
      <Send size={14} className="text-accent" />
      <span className="flex-1">{left > 0 ? `Invio in corso… ${seconds}s` : 'Invio…'}</span>
      {left > 0 && (
        <button onClick={() => undo(pending.id)} className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10">
          Annulla
        </button>
      )}
      <div className="absolute bottom-0 left-0 h-0.5 bg-accent/70 transition-[width] duration-100 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
    </motion.div>
  )
}
