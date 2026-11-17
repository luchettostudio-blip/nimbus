import { AlertTriangle, CalendarClock, Pencil, Send, Trash2 } from 'lucide-react'
import type { OutboxItem } from '@core/models'
import { call } from '../lib/api'
import { formatWhen } from '../lib/schedule'
import { useStore } from '../store'

/** Vista "In programma": modifica, invia subito o annulla gli invii programmati. */
export function ScheduledView() {
  const items = useStore((s) => s.outbox)
  const accounts = useStore((s) => s.accounts)
  const edit = useStore((s) => s.editOutbox)
  const toast = useStore((s) => s.toast)
  const missed = items.filter((i) => i.status === 'missed')

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-6">
        <CalendarClock size={16} className="text-muted" />
        <h1 className="flex-1 text-[15px] font-semibold">In programma</h1>
        <span className="text-[12px] text-muted">{items.length ? `${items.length} ${items.length === 1 ? 'messaggio' : 'messaggi'}` : ''}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {missed.length > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px]">
            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
            <div className="flex-1">
              <div className="font-medium">{missed.length === 1 ? 'Un messaggio non è partito' : `${missed.length} messaggi non sono partiti`}</div>
              <div className="text-[12px] text-muted">Il PC era spento all’orario previsto. Vuoi inviarli ora?</div>
            </div>
            <button
              onClick={() => act(() => call('outbox:sendAllMissed'))}
              className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-strong"
            >
              Invia ora
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-16 text-center text-[13px] text-muted">
            <CalendarClock size={30} strokeWidth={1.3} className="text-faint" />
            Nessun invio programmato.
            <span className="text-[12px] text-faint">Nel compositore usa la freccia accanto a Invia.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Row
                key={item.id}
                item={item}
                from={accounts.length > 1 ? accounts.find((a) => a.id === item.accountId)?.email : undefined}
                onEdit={() => edit(item)}
                onSendNow={() => act(() => call('outbox:sendNow', item.id))}
                onCancel={() => act(() => call('outbox:cancel', item.id), 'Invio annullato')}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Row(props: { item: OutboxItem; from?: string; onEdit: () => void; onSendNow: () => void; onCancel: () => void }) {
  const { item, from, onEdit, onSendNow, onCancel } = props
  const badge =
    item.status === 'missed'
      ? { text: 'Non inviato', cls: 'bg-amber-500/15 text-amber-500' }
      : item.status === 'failed'
        ? { text: 'Errore', cls: 'bg-danger/15 text-danger' }
        : item.status === 'sending'
          ? { text: 'In invio', cls: 'bg-accent/15 text-accent' }
          : null
  const btn = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-muted transition hover:bg-hover hover:text-fg'
  return (
    <div className="group flex items-center gap-4 rounded-xl border border-line bg-surface-2 px-4 py-3">
      <div className="w-36 shrink-0">
        <div className="text-[13px] font-medium">{formatWhen(item.sendAt)}</div>
        {badge && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium ${badge.cls}`}>{badge.text}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{item.draft.subject || '(nessun oggetto)'}</div>
        <div className="truncate text-[12px] text-muted">
          a {item.draft.to.join(', ')}
          {from && <> · da {from}</>}
        </div>
        {item.error && <div className="truncate text-[11.5px] text-danger">{item.error}</div>}
      </div>
      <button className={btn} onClick={onEdit} title="Modifica testo o orario">
        <Pencil size={13} /> Modifica
      </button>
      <button className={btn} onClick={onSendNow} title="Invia subito">
        <Send size={13} /> Invia ora
      </button>
      <button className={`${btn} hover:!text-danger`} onClick={onCancel} title="Annulla l'invio">
        <Trash2 size={13} />
      </button>
    </div>
  )
}
