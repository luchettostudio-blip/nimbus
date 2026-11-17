import { useVirtualizer } from '@tanstack/react-virtual'
import { Paperclip, Search, Star, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MessageSummary } from '@core/models'
import { displayName, relativeDate } from '../lib/format'
import { msgKey, useStore, visibleMessages } from '../store'
import { accountColor, folderLabel } from './Sidebar'

const ROW_HEIGHT = 84

export function MessageList() {
  const messages = useStore((s) => visibleMessages(s))
  const selectedKey = useStore((s) => s.selectedKey)
  const selectMessage = useStore((s) => s.selectMessage)
  const loadOlder = useStore((s) => s.loadOlder)
  const loadingOlder = useStore((s) => s.loadingOlder)
  const view = useStore((s) => s.view)
  const folder = useStore((s) => (s.view?.kind === 'folder' ? s.folders.find((f) => f.path === (s.view as { path: string }).path) : undefined))
  const unifiedUnread = useStore((s) => s.inboxes.reduce((n, f) => n + f.unread, 0))
  const accounts = useStore((s) => s.accounts)
  const searchQuery = useStore((s) => s.searchQuery)
  const search = useStore((s) => s.search)
  const isSearching = useStore((s) => s.searchResults !== null)
  // Pallino colorato dell'account quando la lista mescola più caselle.
  const showAccount = accounts.length > 1 && (view?.kind === 'unified' || isSearching)

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  // Mantiene visibile la riga selezionata quando si naviga con j/k.
  useEffect(() => {
    const idx = messages.findIndex((m) => msgKey(m) === selectedKey)
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  // Scroll infinito: avvicinandosi al fondo carica messaggi più vecchi.
  const items = virtualizer.getVirtualItems()
  const last = items[items.length - 1]
  useEffect(() => {
    if (last && last.index >= messages.length - 15 && messages.length > 0) void loadOlder()
  }, [last?.index, messages.length, loadOlder])

  return (
    <section className="flex w-[380px] shrink-0 flex-col border-r border-line">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        {isSearching ? (
          <>
            <Search size={15} className="text-muted" />
            <h1 className="flex-1 truncate text-[15px] font-semibold">“{searchQuery}”</h1>
            <button onClick={() => search('')} className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg">
              <X size={15} />
            </button>
          </>
        ) : (
          <>
            <h1 className="flex-1 truncate text-[15px] font-semibold">
              {view?.kind === 'unified' ? 'Tutte le caselle' : folder ? folderLabel(folder) : ''}
            </h1>
            {view?.kind === 'unified'
              ? unifiedUnread > 0 && <span className="text-[12px] text-muted">{unifiedUnread} non lette</span>
              : folder && folder.unread > 0 && <span className="text-[12px] text-muted">{folder.unread} non lette</span>}
          </>
        )}
      </header>

      <div ref={parentRef} className="flex-1 overflow-y-auto px-2 pb-2">
        {messages.length === 0 ? (
          <EmptyList searching={isSearching} />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((row) => {
              const m = messages[row.index]
              const key = msgKey(m)
              const acc = showAccount ? accounts.find((a) => a.id === m.accountId) : undefined
              return (
                <div
                  key={key}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  <Row
                    message={m}
                    selected={key === selectedKey}
                    onClick={() => selectMessage(key)}
                    accountColor={acc ? accountColor(acc) : undefined}
                    accountLabel={acc?.email}
                  />
                </div>
              )
            })}
          </div>
        )}
        {loadingOlder && <div className="py-3 text-center text-[12px] text-faint">Caricamento…</div>}
      </div>
    </section>
  )
}

function Row(props: { message: MessageSummary; selected: boolean; onClick: () => void; accountColor?: string; accountLabel?: string }) {
  const { message: m, selected, onClick, accountColor, accountLabel } = props
  return (
    <button
      onClick={onClick}
      className={`group relative flex h-[80px] w-full flex-col justify-center gap-0.5 rounded-xl px-3.5 text-left transition-colors ${
        selected ? 'bg-selected' : 'hover:bg-hover'
      }`}
    >
      {!m.seen && <span className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />}
      <div className="flex items-center gap-2">
        {accountColor && <span title={accountLabel} className="h-2 w-2 shrink-0 rounded-full" style={{ background: accountColor }} />}
        <span className={`flex-1 truncate text-[13.5px] ${m.seen ? 'text-muted' : 'font-semibold text-fg'}`}>{displayName(m.from)}</span>
        {m.wokeAt && Date.now() - m.wokeAt < 7 * 86_400_000 && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[10.5px] font-medium text-amber-500">Rimandata</span>
        )}
        {m.flagged && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
        {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-faint" />}
        <span className={`shrink-0 text-[11.5px] tabular-nums ${m.seen ? 'text-faint' : 'text-accent'}`}>{relativeDate(m.date)}</span>
      </div>
      <div className={`truncate text-[13px] ${m.seen ? 'text-muted' : 'text-fg'}`}>{m.subject}</div>
      <div className="truncate text-[12.5px] text-faint">{m.snippet || ' '}</div>
    </button>
  )
}

function EmptyList({ searching }: { searching: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 pb-16 text-center">
      <div className="text-[28px]">{searching ? '🔎' : '✨'}</div>
      <div className="text-[13px] text-muted">{searching ? 'Nessun risultato' : 'Tutto in ordine. Nessun messaggio qui.'}</div>
    </div>
  )
}
