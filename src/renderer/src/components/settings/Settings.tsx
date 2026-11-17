import { motion } from 'framer-motion'
import { PenLine, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useStore, type SettingsSection } from '../../store'
import { GeneralSection } from './GeneralSection'
import { SignaturesSection } from './SignaturesSection'

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon; render: () => ReactNode }[] = [
  { id: 'general', label: 'Generali', icon: SlidersHorizontal, render: () => <GeneralSection /> },
  { id: 'signatures', label: 'Firme', icon: PenLine, render: () => <SignaturesSection /> }
]

/** Finestra Impostazioni (Ctrl+,). Le sezioni si aggiungono in SECTIONS. */
export function Settings() {
  const section = useStore((s) => s.settingsSection)
  const open = useStore((s) => s.openSettings)
  const close = useStore((s) => s.closeSettings)
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (e.key === 'Escape' && !target?.closest('input,textarea,[contenteditable]')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay pt-10"
      onMouseDown={close}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[min(720px,calc(100vh-80px))] w-[min(920px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl"
      >
        <nav className="w-52 shrink-0 border-r border-line p-3">
          <div className="mb-3 px-2 text-[13px] font-semibold">Impostazioni</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => open(s.id)}
              className={`mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] ${
                s.id === current.id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              <s.icon size={15} strokeWidth={1.8} /> {s.label}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1 overflow-y-auto p-7">
          <button onClick={close} title="Chiudi (Esc)" className="absolute right-4 top-4 rounded-md p-1.5 text-muted hover:bg-hover">
            <X size={16} />
          </button>
          {current.render()}
        </div>
      </motion.div>
    </motion.div>
  )
}
