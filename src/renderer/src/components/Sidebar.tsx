import { motion } from 'framer-motion'
import {
  AlarmClock,
  Archive,
  CalendarClock,
  File,
  Folder as FolderIcon,
  Inbox,
  Layers,
  OctagonAlert,
  PenSquare,
  Plus,
  Send,
  Settings as SettingsIcon,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import type { Account, Folder } from '@core/models'
import { avatarHue } from '../lib/format'
import { useStore } from '../store'

const ROLE_ICON: Record<string, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: File,
  trash: Trash2,
  junk: OctagonAlert,
  archive: Archive,
  all: Layers,
  flagged: Star
}

const ROLE_LABEL: Record<string, string> = {
  inbox: 'Posta in arrivo',
  sent: 'Inviata',
  drafts: 'Bozze',
  trash: 'Cestino',
  junk: 'Spam',
  archive: 'Archivio',
  all: 'Tutti i messaggi',
  flagged: 'Speciali'
}

export function folderLabel(f: Folder): string {
  return (f.role && ROLE_LABEL[f.role]) || f.name
}

/** Colore stabile per distinguere gli account (pallini nella lista unificata, avatar). */
export function accountColor(a: Pick<Account, 'email'> | undefined): string {
  return `hsl(${avatarHue({ name: '', address: a?.email ?? '' })} 60% 58%)`
}

export function Sidebar() {
  const folders = useStore((s) => s.folders)
  const view = useStore((s) => s.view)
  const selectFolder = useStore((s) => s.selectFolder)
  const selectUnified = useStore((s) => s.selectUnified)
  const openCompose = useStore((s) => s.openCompose)
  const accounts = useStore((s) => s.accounts)
  const accountId = useStore((s) => s.accountId)
  const inboxes = useStore((s) => s.inboxes)
  const status = useStore((s) => s.status)
  const selectAccount = useStore((s) => s.selectAccount)
  const setOnboarding = useStore((s) => s.setOnboarding)
  const openSettings = useStore((s) => s.openSettings)
  const outbox = useStore((s) => s.outbox)
  const selectScheduled = useStore((s) => s.selectScheduled)
  const missed = outbox.some((o) => o.status === 'missed' || o.status === 'failed')

  const multi = accounts.length > 1
  const unifiedUnread = inboxes.reduce((n, f) => n + f.unread, 0)
  // La cartella tecnica "Nimbus/Rimandate" non si mostra: c'è la vista "Rimandate".
  const visible = folders.filter((f) => !/(^|[./])Nimbus([./]|$)/.test(f.path))
  const system = visible.filter((f) => f.role)
  const custom = visible.filter((f) => !f.role)
  const snoozes = useStore((s) => s.snoozes)
  const selectSnoozed = useStore((s) => s.selectSnoozed)
  const account = accounts.find((a) => a.id === accountId)
  const isFolderActive = (f: Folder) => view?.kind === 'folder' && view.accountId === f.accountId && view.path === f.path

  return (
    <aside className="flex w-[232px] shrink-0 flex-col px-3 pb-3">
      <button
        onClick={() => openCompose('new')}
        className="mb-4 flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-[13px] font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent-strong active:scale-[0.98]"
      >
        <PenSquare size={15} />
        Scrivi
        <kbd className="ml-auto border-white/20 bg-white/15 text-white/80">C</kbd>
      </button>

      <nav className="-mx-1 flex-1 overflow-y-auto px-1">
        {snoozes.length > 0 && (
          <Row icon={AlarmClock} label="Rimandate" count={snoozes.length} active={view?.kind === 'snoozed'} onClick={() => selectSnoozed()} />
        )}
        {outbox.length > 0 && (
          <Row
            icon={CalendarClock}
            label="In programma"
            count={outbox.length}
            active={view?.kind === 'scheduled'}
            onClick={() => selectScheduled()}
            alert={missed}
          />
        )}
        {multi && (
          <>
            <Row
              icon={Layers}
              label="Tutte le caselle"
              count={unifiedUnread}
              active={view?.kind === 'unified'}
              hint="Ctrl 0"
              onClick={() => selectUnified()}
            />
            <SectionTitle>Account</SectionTitle>
            {accounts.map((a, i) => {
              const unread = inboxes.find((f) => f.accountId === a.id)?.unread ?? 0
              const st = status[a.id]?.state
              return (
                <button
                  key={a.id}
                  onClick={() => selectAccount(a.id)}
                  title={`${a.email}  (Ctrl ${i + 1})`}
                  className={`relative mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                    a.id === accountId && view?.kind === 'folder' ? 'text-fg' : 'text-muted hover:bg-hover hover:text-fg'
                  }`}
                >
                  <span className="relative h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accountColor(a) }}>
                    {(st === 'error' || st === 'offline') && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-danger" />}
                  </span>
                  <span className="flex-1 truncate text-left">{a.displayName || a.email}</span>
                  {unread > 0 && <span className="text-[11px] font-medium tabular-nums text-muted">{unread}</span>}
                </button>
              )
            })}
            <div className="my-3 border-t border-line" />
            {account && <div className="mb-1 truncate px-2.5 text-[11px] font-medium text-faint">{account.email}</div>}
          </>
        )}

        {system.map((f) => (
          <FolderRow key={f.path} folder={f} active={isFolderActive(f)} onClick={() => selectFolder(f.path)} />
        ))}
        {custom.length > 0 && (
          <>
            <SectionTitle>Cartelle</SectionTitle>
            {custom.map((f) => (
              <FolderRow key={f.path} folder={f} active={isFolderActive(f)} onClick={() => selectFolder(f.path)} />
            ))}
          </>
        )}
      </nav>

      <div className="mt-2 border-t border-line pt-2">
        {!multi && account && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: accountColor(account) }}
            >
              {(account.displayName || account.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{account.displayName || account.email.split('@')[0]}</div>
              <div className="truncate text-[11px] text-muted">{account.email}</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOnboarding(true)}
            className="flex h-8 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted transition hover:bg-hover hover:text-fg"
          >
            <Plus size={15} /> Aggiungi account
          </button>
          <button
            onClick={() => openSettings()}
            title="Impostazioni (Ctrl+,)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg"
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 mt-5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</div>
}

function FolderRow({ folder, active, onClick }: { folder: Folder; active: boolean; onClick: () => void }) {
  const Icon = (folder.role && ROLE_ICON[folder.role]) || FolderIcon
  const showCount = folder.unread > 0 && folder.role !== 'trash' && folder.role !== 'junk' && folder.role !== 'sent'
  return <Row icon={Icon} label={folderLabel(folder)} count={showCount ? folder.unread : 0} active={active} onClick={onClick} />
}

function Row(props: { icon: LucideIcon; label: string; count: number; active: boolean; onClick: () => void; hint?: string; alert?: boolean }) {
  const { icon: Icon, label, count, active, onClick, hint, alert } = props
  return (
    <button
      onClick={onClick}
      title={hint ? `${label}  (${hint})` : label}
      className={`relative mb-0.5 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
        active ? 'text-fg' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {active && (
        <motion.div layoutId="folder-active" className="absolute inset-0 rounded-lg bg-selected" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
      )}
      <Icon size={15} className="relative shrink-0" strokeWidth={1.8} />
      <span className="relative flex-1 truncate text-left">{label}</span>
      {count > 0 && <span className={`relative text-[11px] font-medium tabular-nums ${alert ? 'text-amber-500' : 'text-accent'}`}>{count}</span>}
    </button>
  )
}
