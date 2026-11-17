import { AnimatePresence, motion } from 'framer-motion'
import { Ban } from 'lucide-react'
import { call } from '../../lib/api'
import { useStore } from '../../store'

/** Proposta di blocco per chi scrive ancora 7 giorni dopo la disiscrizione. */
export function StillSendingBanner() {
  const items = useStore((s) => s.blockSuggestions)
  const dismiss = useStore((s) => s.dismissBlockSuggestion)
  const toast = useStore((s) => s.toast)
  const first = items[0]
  return (
    <AnimatePresence>
      {first && (
        <motion.div
          key={first.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed bottom-5 left-5 z-[62] flex w-[380px] items-start gap-3 rounded-xl border border-line bg-elevated p-4 shadow-2xl"
        >
          <Ban size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-medium">{first.name || first.address} ti scrive ancora</div>
            <div className="mt-0.5 text-[12px] text-muted">Ti sei disiscritto più di 7 giorni fa. Vuoi bloccarlo? Le sue mail finiranno nel Cestino.</div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => {
                  dismiss(first.id)
                  await call('unsub:block', first.accountId, first.address).catch((e) => toast(e.message, 'error'))
                  toast(`${first.name || first.address} bloccato`)
                }}
                className="h-7 rounded-lg bg-danger px-3 text-[12px] font-medium text-white hover:opacity-90"
              >
                Blocca
              </button>
              <button onClick={() => dismiss(first.id)} className="h-7 rounded-lg px-3 text-[12px] text-muted hover:bg-hover hover:text-fg">
                Ignora
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
