import { useEffect } from 'react'
import { call } from '../../lib/api'
import { formatWhen } from '../../lib/schedule'
import { useStore } from '../../store'

const METHOD = { 'one-click': 'Un clic', mailto: 'Mail automatica', browser: 'Pagina web' } as const

/** Impostazioni > Disiscrizioni: storico, chi scrive ancora (→ Blocca), mittenti bloccati. */
export function UnsubscribesSection() {
  const list = useStore((s) => s.unsubscriptions)
  const load = useStore((s) => s.loadUnsubscriptions)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      toast(msg)
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div>
      <h2 className="text-[17px] font-semibold">Disiscrizioni</h2>
      <p className="mb-5 mt-1 text-[12.5px] text-muted">
        Se un mittente scrive ancora 7 giorni dopo la disiscrizione, puoi bloccarlo: le sue mail andranno direttamente nel Cestino.
      </p>
      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-[13px] text-muted">
          Nessuna disiscrizione. Usa “Disiscriviti” su una newsletter.
        </div>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line">
          {list.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{u.name || u.address}</div>
                <div className="truncate text-[12px] text-muted">
                  {u.address} · {METHOD[u.method]} · {formatWhen(u.createdAt)}
                </div>
              </div>
              {u.blocked ? (
                <>
                  <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">Bloccato</span>
                  <button onClick={() => act(() => call('unsub:unblock', u.accountId, u.address), 'Mittente sbloccato')} className="text-[12px] text-muted hover:text-fg">
                    Sblocca
                  </button>
                </>
              ) : u.stillSending ? (
                <>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">Scrive ancora</span>
                  <button
                    onClick={() => act(() => call('unsub:block', u.accountId, u.address), 'Mittente bloccato')}
                    className="h-7 rounded-lg bg-danger px-2.5 text-[12px] font-medium text-white hover:opacity-90"
                  >
                    Blocca
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] text-faint">In attesa di conferma</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
