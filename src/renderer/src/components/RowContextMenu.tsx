import { motion } from 'framer-motion'
import { Archive, Bell, Inbox, MailX, Newspaper, Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { InboxCategory } from '@core/models'
import { isSplitInbox, msgKey, useStore, visibleMessages } from '../store'

const TABS: { id: InboxCategory; label: string; icon: LucideIcon }[] = [
  { id: 'people', label: 'Persone', icon: Inbox },
  { id: 'newsletter', label: 'Newsletter', icon: Newspaper },
  { id: 'notifications', label: 'Notifiche', icon: Bell }
]

/** Menu del clic destro su una riga della lista. Le funzioni aggiungono qui le loro voci. */
export function RowContextMenu({ extra }: { extra?: (key: string) => ReactNode }) {
  const menu = useStore((s) => s.contextMenu)!
  const close = useStore((s) => s.closeContextMenu)
  const msg = useStore((s) => visibleMessages(s).find((m) => msgKey(m) === s.contextMenu?.key))
  const split = useStore((s) => isSplitInbox(s))
  const moveToTab = useStore((s) => s.moveToTab)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', close)
    }
  }, [close])

  if (!msg) return null
  // Non uscire dalla finestra.
  const x = Math.min(menu.x, window.innerWidth - 240)
  const y = Math.min(menu.y, window.innerHeight - 260)
  const sender = msg.from?.name || msg.from?.address || 'questo mittente'

  const act = async (fn: () => unknown) => {
    close()
    await useStore.getState().selectMessage(menu.key)
    await fn()
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.08 }}
      style={{ left: x, top: y }}
      className="fixed z-[80] w-56 rounded-xl border border-line bg-elevated p-1 text-[13px] shadow-2xl"
    >
      {split && (
        <>
          <div className="truncate px-2.5 pb-1 pt-1.5 text-[11px] text-faint">Sposta {sender} in…</div>
          {TABS.filter((t) => t.id !== (msg.category ?? 'people')).map((t) => (
            <Item key={t.id} icon={t.icon} onClick={() => moveToTab(menu.key, t.id)}>
              {t.label}
            </Item>
          ))}
          <div className="my-1 h-px bg-line" />
        </>
      )}
      {extra?.(menu.key)}
      {msg.listUnsubscribe && msg.from && (
        <Item icon={MailX} onClick={() => void useStore.getState().askUnsubscribe(msg.accountId, msg.from!.address, msg.from!.name || null)}>
          Disiscriviti
        </Item>
      )}
      <Item icon={Archive} onClick={() => act(() => useStore.getState().archive())}>
        Archivia
      </Item>
      <Item icon={Trash2} onClick={() => act(() => useStore.getState().trash())}>
        Elimina
      </Item>
    </motion.div>
  )
}

export function Item({ icon: Icon, children, onClick }: { icon: LucideIcon; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover">
      <Icon size={14} className="text-muted" />
      {children}
    </button>
  )
}
