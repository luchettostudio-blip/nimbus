import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'
import { UndoSendToasts } from './UndoSendToast'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            className={`rounded-xl border px-4 py-2 text-[13px] shadow-lg ${
              t.kind === 'error' ? 'border-danger/30 bg-elevated text-danger' : 'border-line bg-elevated text-fg'
            }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
      <UndoSendToasts />
    </div>
  )
}
