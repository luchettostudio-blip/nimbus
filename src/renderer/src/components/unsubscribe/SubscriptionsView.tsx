import { ArrowLeft, Ban, Check, Newspaper } from 'lucide-react'
import { useEffect } from 'react'
import { relativeDate } from '../../lib/format'
import { useStore } from '../../store'

/** "Gestisci iscrizioni": tutti i mittenti di newsletter, quante mail al mese, disiscrizione. */
export function SubscriptionsView() {
  const subs = useStore((s) => s.subscriptions)
  const load = useStore((s) => s.loadSubscriptions)
  const ask = useStore((s) => s.askUnsubscribe)
  const back = useStore((s) => s.closeSubscriptions)
  const accounts = useStore((s) => s.accounts)

  useEffect(() => {
    void load()
  }, [load])

  const active = subs.filter((s) => !s.unsubscribed && !s.blocked)
  const done = subs.filter((s) => s.unsubscribed || s.blocked)

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-6">
        <button onClick={back} title="Torna alla Posta in arrivo" className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
          <ArrowLeft size={16} />
        </button>
        <Newspaper size={16} className="text-muted" />
        <h1 className="flex-1 text-[15px] font-semibold">Gestisci iscrizioni</h1>
        <span className="text-[12px] text-muted">{active.length} attive</span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {subs.length === 0 && <div className="py-16 text-center text-[13px] text-muted">Nessuna newsletter trovata.</div>}
        <div className="space-y-1.5">
          {active.map((s) => (
            <div key={`${s.accountId}|${s.address}`} className="flex items-center gap-4 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{s.name || s.address}</div>
                <div className="truncate text-[12px] text-muted">
                  {s.address}
                  {accounts.length > 1 && <> · {accounts.find((a) => a.id === s.accountId)?.email}</>}
                </div>
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="text-[13px] font-medium tabular-nums">{s.perMonth} al mese</div>
                <div className="text-[11px] text-faint">ultima {relativeDate(s.lastAt)}</div>
              </div>
              <button
                onClick={() => ask(s.accountId, s.address, s.name)}
                disabled={!s.method}
                title={s.method ? undefined : 'Il mittente non indica come disiscriversi'}
                className="h-8 rounded-lg border border-line px-3 text-[12.5px] transition hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
              >
                Disiscriviti
              </button>
            </div>
          ))}
        </div>
        {done.length > 0 && (
          <>
            <div className="mb-2 mt-6 text-[11px] font-medium uppercase tracking-wider text-faint">Già disiscritte</div>
            <div className="space-y-1.5 opacity-70">
              {done.map((s) => (
                <div key={`${s.accountId}|${s.address}`} className="flex items-center gap-3 rounded-xl px-4 py-2 text-[13px]">
                  {s.blocked ? <Ban size={14} className="text-danger" /> : <Check size={14} className="text-accent" />}
                  <span className="flex-1 truncate">{s.name || s.address}</span>
                  <span className="text-[12px] text-faint">{s.blocked ? 'Bloccato' : 'Disiscritto'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
