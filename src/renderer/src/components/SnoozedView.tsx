import { AlarmClock, Undo2 } from 'lucide-react'
import { displayName } from '../lib/format'
import { formatWhen } from '../lib/schedule'
import { useStore } from '../store'

/** Vista "Rimandate": quando torna ogni mail, con possibilità di annullare. */
export function SnoozedView() {
  const items = useStore((s) => s.snoozes)
  const accounts = useStore((s) => s.accounts)
  const cancel = useStore((s) => s.cancelSnooze)

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-6">
        <AlarmClock size={16} className="text-muted" />
        <h1 className="flex-1 text-[15px] font-semibold">Rimandate</h1>
        <span className="text-[12px] text-muted">{items.length ? `${items.length} ${items.length === 1 ? 'mail' : 'mail'}` : ''}</span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-16 text-center text-[13px] text-muted">
            <AlarmClock size={30} strokeWidth={1.3} className="text-faint" />
            Nessuna mail rimandata.
            <span className="text-[12px] text-faint">
              Premi <kbd>H</kbd> su una mail per farla tornare più tardi.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-4 rounded-xl border border-line bg-surface-2 px-4 py-3">
                <div className="w-36 shrink-0">
                  <div className="text-[11px] text-faint">Torna</div>
                  <div className="text-[13px] font-medium">{formatWhen(s.wakeAt)}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{s.subject}</div>
                  <div className="truncate text-[12px] text-muted">
                    {displayName(s.from)} · {s.snippet}
                    {accounts.length > 1 && <> · {accounts.find((a) => a.id === s.accountId)?.email}</>}
                  </div>
                </div>
                <button
                  onClick={() => cancel(s.id)}
                  title="Riporta subito in Posta in arrivo"
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-muted transition hover:bg-hover hover:text-fg"
                >
                  <Undo2 size={13} /> Annulla
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
