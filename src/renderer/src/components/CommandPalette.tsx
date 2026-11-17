import { motion } from 'framer-motion'
import {
  Archive,
  Folder,
  Layers,
  Forward,
  Mail,
  MailOpen,
  Monitor,
  Moon,
  PenLine,
  PenSquare,
  Settings as SettingsIcon,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Star,
  Sun,
  Trash2,
  User,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '../lib/api'
import { useStore } from '../store'
import { folderLabel } from './Sidebar'

interface Cmd {
  id: string
  label: string
  group: string
  icon: LucideIcon
  hotkey?: string
  run: () => void
}

/** Command palette (Ctrl+K): comandi, cartelle, account e ricerca messaggi. */
export function CommandPalette() {
  const setPalette = useStore((s) => s.setPalette)
  const folders = useStore((s) => s.folders)
  const accounts = useStore((s) => s.accounts)
  const hasSelection = useStore((s) => s.selectedKey !== null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const commands = useMemo<Cmd[]>(() => {
    const s = useStore.getState()
    const close = () => setPalette(false)
    const act = (fn: () => unknown) => () => {
      close()
      void fn()
    }
    const list: Cmd[] = [
      { id: 'compose', label: 'Scrivi nuovo messaggio', group: 'Azioni', icon: PenSquare, hotkey: 'C', run: act(() => s.openCompose('new')) }
    ]
    if (hasSelection) {
      list.push(
        { id: 'reply', label: 'Rispondi', group: 'Messaggio', icon: Reply, hotkey: 'R', run: act(() => s.openCompose('reply')) },
        { id: 'replyAll', label: 'Rispondi a tutti', group: 'Messaggio', icon: ReplyAll, hotkey: 'A', run: act(() => s.openCompose('replyAll')) },
        { id: 'forward', label: 'Inoltra', group: 'Messaggio', icon: Forward, hotkey: 'F', run: act(() => s.openCompose('forward')) },
        { id: 'archive', label: 'Archivia', group: 'Messaggio', icon: Archive, hotkey: 'E', run: act(s.archive) },
        { id: 'trash', label: 'Elimina', group: 'Messaggio', icon: Trash2, hotkey: '#', run: act(s.trash) },
        { id: 'seen', label: 'Segna come letto / non letto', group: 'Messaggio', icon: MailOpen, hotkey: 'U', run: act(s.toggleSeen) },
        { id: 'flag', label: 'Aggiungi / rimuovi speciale', group: 'Messaggio', icon: Star, hotkey: 'S', run: act(s.toggleFlagged) }
      )
    }
    for (const f of folders) {
      list.push({ id: `folder:${f.path}`, label: `Vai a ${folderLabel(f)}`, group: 'Cartelle', icon: f.role === 'inbox' ? Mail : Folder, run: act(() => s.selectFolder(f.path)) })
    }
    if (accounts.length > 1) {
      list.push({ id: 'unified', label: 'Tutte le caselle (inbox unificata)', group: 'Account', icon: Layers, hotkey: 'Ctrl 0', run: act(() => s.selectUnified()) })
    }
    accounts.forEach((a, i) => {
      list.push({
        id: `account:${a.id}`,
        label: `Passa a ${a.email}`,
        group: 'Account',
        icon: User,
        hotkey: i < 9 ? `Ctrl ${i + 1}` : undefined,
        run: act(() => s.selectAccount(a.id))
      })
    })
    list.push(
      { id: 'addAccount', label: 'Aggiungi account', group: 'Account', icon: Plus, run: act(() => s.setOnboarding(true)) },
      {
        id: 'refresh',
        label: 'Aggiorna ora',
        group: 'App',
        icon: RefreshCw,
        run: act(() => (s.view?.kind === 'folder' ? s.selectFolder(s.view.path) : s.selectUnified()))
      },
      { id: 'reconnect', label: 'Riconnetti account', group: 'App', icon: RefreshCw, run: act(() => call('app:reconnect')) },
      { id: 'settings', label: 'Impostazioni', group: 'App', icon: SettingsIcon, hotkey: 'Ctrl ,', run: act(() => s.openSettings('general')) },
      { id: 'signatures', label: 'Gestisci firme', group: 'App', icon: PenLine, run: act(() => s.openSettings('signatures')) },
      { id: 'theme:system', label: 'Tema: segui Windows', group: 'Aspetto', icon: Monitor, run: act(() => call('app:setTheme', 'system')) },
      { id: 'theme:dark', label: 'Tema: scuro', group: 'Aspetto', icon: Moon, run: act(() => call('app:setTheme', 'dark')) },
      { id: 'theme:light', label: 'Tema: chiaro', group: 'Aspetto', icon: Sun, run: act(() => call('app:setTheme', 'light')) }
    )
    return list
  }, [folders, accounts, hasSelection, setPalette])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? commands.filter((c) => fuzzy(c.label.toLowerCase(), q)) : commands
    if (q) {
      matches.push({
        id: 'search',
        label: `Cerca messaggi: “${query.trim()}”`,
        group: 'Ricerca',
        icon: Search,
        run: () => {
          setPalette(false)
          void useStore.getState().search(query.trim())
        }
      })
    }
    return matches
  }, [commands, query, setPalette])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[index]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setPalette(false)
    }
  }

  let lastGroup = ''
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-[14vh]"
      onMouseDown={() => setPalette(false)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-[min(600px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digita un comando o cerca…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <kbd>Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5">
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            const Icon = c.icon
            return (
              <div key={c.id}>
                {header && <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium text-faint">{header}</div>}
                <button
                  data-idx={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={c.run}
                  className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] ${i === index ? 'bg-selected text-fg' : 'text-muted'}`}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hotkey && <kbd>{c.hotkey}</kbd>}
                </button>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-faint">Nessun comando</div>}
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Match "fuzzy" semplice: i caratteri della query compaiono in ordine. */
function fuzzy(text: string, q: string): boolean {
  if (text.includes(q)) return true
  let i = 0
  for (const ch of text) if (ch === q[i]) i++
  return i === q.length
}
