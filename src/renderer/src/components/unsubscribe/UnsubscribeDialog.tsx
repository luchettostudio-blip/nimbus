import { motion } from 'framer-motion'
import { Globe, Loader2, Mail, MailX, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { useStore } from '../../store'

const METHOD_TEXT = {
  'one-click': { icon: Zap, text: 'Disiscrizione automatica con un clic: Nimbus avvisa il mittente senza aprire nessuna pagina.' },
  mailto: { icon: Mail, text: 'Nimbus invierà in automatico la mail di disiscrizione dal tuo account.' },
  browser: { icon: Globe, text: 'Il mittente richiede di confermare sul suo sito: si aprirà la pagina nel browser.' }
} as const

/** Conferma prima della disiscrizione, con opzione di archiviare tutte le mail del mittente. */
export function UnsubscribeDialog() {
  // Durante l'animazione di uscita lo stato è già null: si mostra l'ultimo valore.
  const live = useStore((s) => s.unsubDialog)
  const lastRef = useRef(live!)
  if (live) lastRef.current = live
  const d = lastRef.current
  const close = useStore((s) => s.closeUnsubscribe)
  const confirm = useStore((s) => s.confirmUnsubscribe)
  const [archiveAll, setArchiveAll] = useState(true)
  const [busy, setBusy] = useState(false)
  const m = METHOD_TEXT[d.plan.method]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-[420px] rounded-2xl border border-line bg-elevated p-6 shadow-2xl"
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/15 text-danger">
          <MailX size={20} />
        </div>
        <h2 className="text-[16px] font-semibold">Disiscriverti da {d.name || d.address}?</h2>
        <p className="mt-1 text-[12.5px] text-muted">{d.address}</p>
        <div className="mt-4 flex gap-2.5 rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">
          <m.icon size={15} className="mt-0.5 shrink-0 text-accent" />
          {m.text}
        </div>
        <label className="mt-4 flex items-center gap-2.5 text-[13px]">
          <input type="checkbox" checked={archiveAll} onChange={(e) => setArchiveAll(e.target.checked)} className="accent-[var(--accent)]" />
          Archivia anche tutte le mail di questo mittente
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={close} className="h-9 rounded-xl px-4 text-[13px] text-muted hover:bg-hover hover:text-fg">
            Annulla
          </button>
          <button
            autoFocus
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await confirm(archiveAll)
              setBusy(false)
            }}
            className="flex h-9 items-center gap-2 rounded-xl bg-danger px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Disiscriviti
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
