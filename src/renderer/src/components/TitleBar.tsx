import { Search } from 'lucide-react'
import { BRAND } from '../lib/theme'
import { useStore } from '../store'
import { Logo } from './Logo'

/**
 * Barra del titolo personalizzata. Tutta l'area è trascinabile; a destra resta
 * lo spazio per i pulsanti nativi min/max/chiudi forniti da `titleBarOverlay`.
 */
export function TitleBar() {
  const setPalette = useStore((s) => s.setPalette)
  const account = useStore((s) => (s.view?.kind === 'unified' ? undefined : s.accounts.find((a) => a.id === s.accountId)))
  const accountCount = useStore((s) => s.accounts.length)
  // Stato dell'account corrente; nella vista unificata quello "peggiore" fra tutti.
  const status = useStore((s) => {
    if (s.view?.kind !== 'unified') return s.accountId ? s.status[s.accountId] : undefined
    const all = Object.values(s.status)
    return all.find((x) => x.state === 'error') ?? all.find((x) => x.state === 'offline') ?? all.find((x) => x.state !== 'idle')
  })

  const statusLabel =
    status?.state === 'syncing' || status?.state === 'connecting'
      ? 'Sincronizzazione…'
      : status?.state === 'offline'
        ? 'Offline'
        : status?.state === 'error'
          ? 'Errore di connessione'
          : null

  return (
    <div className="drag flex h-10 shrink-0 items-center pl-4 pr-[150px] text-[12px] text-muted">
      <div className="flex w-[232px] items-center gap-2 font-medium text-fg/80">
        <Logo size={15} />
        {BRAND.name}
      </div>

      <button
        onClick={() => setPalette(true)}
        className="no-drag mx-auto flex h-7 w-full max-w-[420px] items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-muted transition-colors hover:bg-hover"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Cerca o esegui un comando…</span>
        <span className="flex items-center gap-0.5 text-[11px] text-faint">
          Ctrl K
        </span>
      </button>

      <div className="flex w-[200px] items-center justify-end gap-2">
        {statusLabel && (
          <span className="flex items-center gap-1.5" title={status?.error}>
            <span
              className={`h-1.5 w-1.5 rounded-full ${status?.state === 'error' || status?.state === 'offline' ? 'bg-danger' : 'animate-pulse bg-accent'}`}
            />
            {statusLabel}
          </span>
        )}
        {!statusLabel && account && <span className="truncate">{account.email}</span>}
        {!statusLabel && !account && accountCount > 1 && <span>{accountCount} caselle</span>}
      </div>
    </div>
  )
}
