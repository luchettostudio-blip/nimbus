import { AnimatePresence, motion } from 'framer-motion'
import { Calendar, ChevronDown, Folder, Paperclip, Search, User, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { operatorValue, removeOperator, setOperator } from '@core/features/search/query'
import { useStore } from '../../store'
import { folderLabel } from '../Sidebar'

/**
 * Barra di ricerca della lista: risultati mentre scrivi (debounce 150 ms),
 * operatori (da:, a:, oggetto:, ha:allegato, ha:pdf, prima:, dopo:, in:, non:letto, "frase")
 * e chip cliccabili che aggiungono/tolgono gli operatori dalla query.
 */
export function SearchBar() {
  const query = useStore((s) => s.searchQuery)
  const search = useStore((s) => s.search)
  const close = useStore((s) => s.closeSearch)
  const results = useStore((s) => s.searchResults)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  return (
    <div className="shrink-0 border-b border-line px-3 pb-2.5 pt-2.5">
      <div className="flex h-9 items-center gap-2 rounded-xl border border-accent/40 bg-surface-2 px-3 ring-4 ring-accent/10">
        <Search size={14} className="text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              // Passa ai risultati: j/k e frecce funzionano sulla lista.
              e.preventDefault()
              inputRef.current?.blur()
              useStore.getState().moveSelection(1)
            }
          }}
          placeholder="Cerca… es. da:mario ha:pdf fattura"
          className="selectable min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        {results && <span className="shrink-0 text-[11px] tabular-nums text-faint">{results.length}</span>}
        <button onClick={close} title="Chiudi la ricerca (Esc)" className="rounded-md p-0.5 text-muted hover:bg-hover hover:text-fg">
          <X size={14} />
        </button>
      </div>
      <Chips />
    </div>
  )
}

function Chips() {
  const query = useStore((s) => s.searchQuery)
  const search = useStore((s) => s.search)
  const folders = useStore((s) => s.folders)
  const accounts = useStore((s) => s.accounts)
  const [open, setOpen] = useState<'da' | 'data' | 'in' | 'account' | null>(null)

  const toggle = (op: string, value: string) => search(operatorValue(query, op) === value ? removeOperator(query, op) : setOperator(query, op, value))
  const daysAgo = (n: number) => {
    const d = new Date(Date.now() - n * 86_400_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const from = operatorValue(query, 'da')
  const hasAtt = operatorValue(query, 'ha') === 'allegato'
  const after = operatorValue(query, 'dopo')
  const inFolder = operatorValue(query, 'in')
  const account = operatorValue(query, 'account')

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Chip icon={<UserRound size={12} />} label={from ? `Da: ${from}` : 'Da'} active={!!from} onClick={() => (from ? search(removeOperator(query, 'da')) : setOpen(open === 'da' ? null : 'da'))}>
        {open === 'da' && <FromInput onDone={(v) => (setOpen(null), v && search(setOperator(query, 'da', v)))} />}
      </Chip>
      <Chip icon={<Paperclip size={12} />} label="Allegati" active={hasAtt} onClick={() => toggle('ha', 'allegato')} />
      <Chip
        icon={<Calendar size={12} />}
        label={after ? `Dal ${after.split('-').reverse().join('/')}` : 'Data'}
        active={!!after}
        menu
        onClick={() => (after ? search(removeOperator(query, 'dopo')) : setOpen(open === 'data' ? null : 'data'))}
      >
        {open === 'data' && (
          <Menu onClose={() => setOpen(null)}>
            {[
              ['Ultimi 7 giorni', 7],
              ['Ultimo mese', 30],
              ['Ultimi 3 mesi', 90],
              ['Ultimo anno', 365]
            ].map(([label, days]) => (
              <MenuItem key={label} onClick={() => (setOpen(null), search(setOperator(query, 'dopo', daysAgo(days as number))))}>
                {label}
              </MenuItem>
            ))}
          </Menu>
        )}
      </Chip>
      <Chip icon={<Folder size={12} />} label={inFolder ? `In: ${inFolder}` : 'Cartella'} active={!!inFolder} menu onClick={() => (inFolder ? search(removeOperator(query, 'in')) : setOpen(open === 'in' ? null : 'in'))}>
        {open === 'in' && (
          <Menu onClose={() => setOpen(null)}>
            {folders
              .filter((f) => !/(^|[./])Nimbus([./]|$)/.test(f.path))
              .map((f) => (
                <MenuItem key={f.path} onClick={() => (setOpen(null), search(setOperator(query, 'in', f.name)))}>
                  {folderLabel(f)}
                </MenuItem>
              ))}
          </Menu>
        )}
      </Chip>
      {accounts.length > 1 && (
        <Chip icon={<User size={12} />} label={account ? `Account: ${account}` : 'Account'} active={!!account} menu onClick={() => (account ? search(removeOperator(query, 'account')) : setOpen(open === 'account' ? null : 'account'))}>
          {open === 'account' && (
            <Menu onClose={() => setOpen(null)}>
              {accounts.map((a) => (
                <MenuItem key={a.id} onClick={() => (setOpen(null), search(setOperator(query, 'account', a.email)))}>
                  {a.email}
                </MenuItem>
              ))}
            </Menu>
          )}
        </Chip>
      )}
    </div>
  )
}

function Chip(props: { icon: ReactNode; label: string; active: boolean; onClick: () => void; menu?: boolean; children?: ReactNode }) {
  const { icon, label, active, onClick, menu, children } = props
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] transition ${
          active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg'
        }`}
      >
        {icon}
        <span className="max-w-[130px] truncate">{label}</span>
        {active ? <X size={11} /> : menu ? <ChevronDown size={11} /> : null}
      </button>
      <AnimatePresence>{children}</AnimatePresence>
    </div>
  )
}

function Menu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [onClose])
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="absolute left-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-xl"
    >
      {children}
    </motion.div>
  )
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover">
      {children}
    </button>
  )
}

function FromInput({ onDone }: { onDone: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <Menu onClose={() => onDone('')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onDone(v.trim())
        }}
        className="p-1"
      >
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onDone(''))}
          placeholder="Nome o indirizzo"
          className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none focus:border-accent/60"
        />
      </form>
    </Menu>
  )
}

/** Rende un testo con le parti trovate (\u0002…\u0003) evidenziate. */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0002') ? (
          <mark key={i} className="rounded-sm bg-amber-400/35 px-px text-fg">
            {p.slice(1, -1)}
          </mark>
        ) : (
          p
        )
      )}
    </>
  )
}
