import { useVirtualizer } from '@tanstack/react-virtual'
import { CloudDownload, Loader2, Paperclip, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MessageSummary } from '@core/models'
import { displayName, relativeDate } from '../lib/format'
import { isSplitInbox, msgKey, useStore, visibleMessages } from '../store'
import type { InboxCategory } from '@core/models'
import { accountColor, folderLabel } from './Sidebar'
import { Highlighted, SearchBar } from './search/SearchBar'

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
  const searchOpen = useStore((s) => s.searchOpen)
  const searchQuery = useStore((s) => s.searchQuery)
  const searchServer = useStore((s) => s.searchServer)
  const serverSearching = useStore((s) => s.serverSearching)
  const isSearching = useStore((s) => s.searchResults !== null)
  const split = useStore((s) => isSplitInbox(s) && !s.searchOpen)
  const openContextMenu = useStore((s) => s.openContextMenu)
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
      {searchOpen ? (
        <SearchBar />
      ) : (
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
          <>
            <h1 className="flex-1 truncate text-[15px] font-semibold">
              {view?.kind === 'unified' ? 'Tutte le caselle' : folder ? folderLabel(folder) : ''}
            </h1>
            {view?.kind === 'unified'
              ? unifiedUnread > 0 && <span className="text-[12px] text-muted">{unifiedUnread} non lette</span>
              : folder && folder.unread > 0 && <span className="text-[12px] text-muted">{folder.unread} non lette</span>}
          </>
      </header>
      )}
      {split && <InboxTabs />}

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
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openContextMenu(e.clientX, e.clientY, key)
                    }}
                    draggableKey={split ? key : undefined}
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
        {searchOpen && searchQuery.trim() && (
          <button
            onClick={() => searchServer()}
            disabled={serverSearching}
            className="mx-auto my-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-muted transition hover:bg-hover hover:text-fg disabled:opacity-60"
          >
            {serverSearching ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
            Cerca anche sul server
          </button>
        )}
      </div>
    </section>
  )
}

function Row(props: {
  message: MessageSummary
  selected: boolean
  onClick: () => void
  accountColor?: string
  accountLabel?: string
  onContextMenu: (e: React.MouseEvent) => void
  /** Se presente la riga si può trascinare su una scheda dell'inbox. */
  draggableKey?: string
}) {
  const { message: m, selected, onClick, accountColor, accountLabel, onContextMenu, draggableKey } = props
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={!!draggableKey}
      onDragStart={(e) => {
        if (!draggableKey) return
        e.dataTransfer.setData('application/x-nimbus-message', draggableKey)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`group relative flex h-[80px] w-full flex-col justify-center gap-0.5 rounded-xl px-3.5 text-left transition-colors ${
        selected ? 'bg-selected' : 'hover:bg-hover'
      }`}
    >
      {!m.seen && <span className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />}
      <div className="flex items-center gap-2">
        {accountColor && <span title={accountLabel} className="h-2 w-2 shrink-0 rounded-full" style={{ background: accountColor }} />}
        <span className={`flex-1 truncate text-[13.5px] ${m.seen && !m.threadUnread ? 'text-muted' : 'font-semibold text-fg'}`}>
          {(m.threadCount ?? 1) > 1 && (m.participants?.length ?? 0) > 1 ? m.participants!.join(', ') : displayName(m.from)}
          {(m.threadCount ?? 1) > 1 && <span className="ml-1.5 text-[11.5px] font-normal tabular-nums text-faint">{m.threadCount}</span>}
        </span>
        {m.wokeAt && Date.now() - m.wokeAt < 7 * 86_400_000 && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[10.5px] font-medium text-amber-500">Rimandata</span>
        )}
        {m.flagged && <Star size={12} className="shrink-0 fill-amber-400 text-amber-400" />}
        {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-faint" />}
        <span className={`shrink-0 text-[11.5px] tabular-nums ${m.seen ? 'text-faint' : 'text-accent'}`}>{relativeDate(m.date)}</span>
      </div>
      <div className={`truncate text-[13px] ${m.seen ? 'text-muted' : 'text-fg'}`}>
        {m.highlight?.subject ? <Highlighted text={m.highlight.subject} /> : m.subject}
      </div>
      <div className="truncate text-[12.5px] text-faint">
        {m.highlight?.snippet ? <Highlighted text={m.highlight.snippet} /> : m.snippet || ' '}
      </div>
    </button>
  )
}

const TABS: { id: InboxCategory; label: string }[] = [
  { id: 'people', label: 'Persone' },
  { id: 'newsletter', label: 'Newsletter' },
  { id: 'notifications', label: 'Notifiche' }
]

/** Schede della Posta in arrivo divisa: tasti 1-2-3, badge non lette, destinazione del trascinamento. */
function InboxTabs() {
  const tab = useStore((s) => s.inboxTab)
  const counts = useStore((s) => s.tabCounts)
  const setTab = useStore((s) => s.setInboxTab)
  const moveToTab = useStore((s) => s.moveToTab)
  const openSubscriptions = useStore((s) => s.openSubscriptions)
  const [over, setOver] = useState<InboxCategory | null>(null)
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 pb-2">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          title={`${t.label} (${i + 1})`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-nimbus-message') && t.id !== tab) {
              e.preventDefault()
              setOver(t.id)
            }
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            setOver(null)
            const key = e.dataTransfer.getData('application/x-nimbus-message')
            if (key) void moveToTab(key, t.id)
          }}
          className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition ${
            t.id === tab ? 'bg-selected font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'
          } ${over === t.id ? 'ring-2 ring-accent' : ''}`}
        >
          {t.label}
          {counts[t.id] > 0 && (
            <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${t.id === tab ? 'bg-accent text-white' : 'bg-line text-muted'}`}>{counts[t.id]}</span>
          )}
        </button>
      ))}
      {tab === 'newsletter' && (
        <button onClick={openSubscriptions} className="ml-auto rounded-lg px-2 py-1 text-[11.5px] text-accent hover:bg-accent/10">
          Gestisci iscrizioni
        </button>
      )}
    </div>
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
