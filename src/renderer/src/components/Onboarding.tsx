import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ChevronDown, ExternalLink, Loader2, Lock, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProviderPreset, ServerConfig } from '@core/models'
import { call, IpcError } from '../lib/api'
import { BRAND } from '../lib/theme'
import { useStore } from '../store'
import { Logo } from './Logo'
import { ProviderLogo } from './ProviderLogo'

/**
 * Aggiunta account in due passi:
 *  1. griglia dei provider (Studio Marla in evidenza, poi Gmail, Outlook, iCloud, Altro)
 *  2. con un preset: solo email + password ("Impostazioni avanzate" mostra host/porte modificabili);
 *     con "Altro": tutti i campi manuali.
 * Al salvataggio il main verifica subito IMAP e SMTP.
 */
export function Onboarding() {
  const setOnboarding = useStore((s) => s.setOnboarding)
  const canClose = useStore((s) => s.accounts.length > 0)
  const [providers, setProviders] = useState<ProviderPreset[]>([])
  const [preset, setPreset] = useState<ProviderPreset | null>(null)

  useEffect(() => {
    void call('providers:list').then(setProviders)
  }, [])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-overlay pt-10">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="relative max-h-[calc(100vh-80px)] w-[480px] overflow-y-auto rounded-3xl border border-line bg-elevated p-8 shadow-2xl"
      >
        {canClose && (
          <button type="button" onClick={() => setOnboarding(false)} className="absolute right-4 top-4 rounded-md p-1.5 text-muted hover:bg-hover" title="Chiudi">
            <X size={16} />
          </button>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {preset ? (
            <motion.div key="form" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.16 }}>
              <AccountForm preset={preset} onBack={() => setPreset(null)} />
            </motion.div>
          ) : (
            <motion.div key="grid" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.16 }}>
              <ProviderGrid providers={providers} onPick={setPreset} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function ProviderGrid({ providers, onPick }: { providers: ProviderPreset[]; onPick: (p: ProviderPreset) => void }) {
  const featured = providers.filter((p) => p.featured)
  const others = providers.filter((p) => !p.featured)
  return (
    <div>
      <Logo size={36} />
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Aggiungi un account</h1>
      <p className="mb-6 mt-1 text-[13px] text-muted">Scegli il tuo provider: le impostazioni del server sono già pronte.</p>

      {featured.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p)}
          className="mb-3 flex w-full items-center gap-4 rounded-2xl border border-accent/40 bg-accent/[0.07] p-4 text-left ring-accent/20 transition hover:bg-accent/[0.12] hover:ring-4 active:scale-[0.99]"
        >
          <ProviderLogo preset={p} size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{p.label}</div>
            {p.description && <div className="text-[12.5px] text-muted">{p.description}</div>}
          </div>
          <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-white">Consigliato</span>
        </button>
      ))}

      <div className="grid grid-cols-2 gap-3">
        {others.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3.5 text-left transition hover:bg-hover active:scale-[0.98]"
          >
            <ProviderLogo preset={p} size={36} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">{p.label}</div>
              {p.description && <div className="truncate text-[11.5px] text-muted">{p.description}</div>}
            </div>
          </button>
        ))}
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11.5px] text-faint">
        <Lock size={11} /> Le password vengono cifrate con Windows e restano su questo PC.
      </p>
    </div>
  )
}

interface ServerFieldsState {
  host: string
  port: string
  secure: boolean
}

const toFields = (s: ServerConfig): ServerFieldsState => ({ host: s.host, port: String(s.port), secure: s.secure })

function AccountForm({ preset, onBack }: { preset: ProviderPreset; onBack: () => void }) {
  const accountAdded = useStore((s) => s.accountAdded)
  const manual = !!preset.manual
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [imap, setImap] = useState(toFields(preset.imap))
  const [smtp, setSmtp] = useState(toFields(preset.smtp))
  const [advanced, setAdvanced] = useState(manual)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<IpcError | null>(null)

  // "Altro": suggerisce imap./smtp.<dominio> appena si conosce il dominio.
  const onEmailBlur = () => {
    const domain = email.split('@')[1]?.trim()
    if (manual && domain) {
      if (!imap.host) setImap((s) => ({ ...s, host: `imap.${domain}` }))
      if (!smtp.host) setSmtp((s) => ({ ...s, host: `smtp.${domain}` }))
    }
  }

  const smtpChanged = smtp.host !== preset.smtp.host || Number(smtp.port) !== preset.smtp.port || smtp.secure !== preset.smtp.secure

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const smtpConfig: ServerConfig = { host: smtp.host.trim(), port: Number(smtp.port), secure: smtp.secure }
      const account = await call('accounts:add', {
        email: email.trim(),
        password,
        displayName: displayName.trim() || undefined,
        username: username.trim() || undefined,
        providerId: preset.id,
        imap: { host: imap.host.trim(), port: Number(imap.port), secure: imap.secure },
        // Se l'utente ha modificato l'SMTP a mano, il fallback del preset non vale più.
        smtp: smtpChanged ? smtpConfig : { ...preset.smtp, ...smtpConfig },
        smtpFallbacks: smtpChanged ? undefined : preset.smtpFallbacks
      })
      await accountAdded(account)
    } catch (err) {
      setError(err instanceof IpcError ? err : new IpcError((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const input =
    'h-10 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[13.5px] outline-none transition focus:border-accent/60 focus:ring-4 focus:ring-accent/10 placeholder:text-faint'

  return (
    <form onSubmit={submit}>
      <button type="button" onClick={onBack} className="-ml-1 mb-4 flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] text-muted hover:text-fg">
        <ArrowLeft size={13} /> Provider
      </button>
      <div className="flex items-center gap-3">
        <ProviderLogo preset={preset} size={40} />
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">{manual ? 'Configurazione manuale' : preset.label}</h1>
          <p className="text-[12.5px] text-muted">{manual ? 'Inserisci i dati dei server IMAP e SMTP.' : 'Ti servono solo email e password.'}</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <input className={input} type="email" required autoFocus placeholder="nome@dominio.it" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={onEmailBlur} />
        <input
          className={input}
          type="password"
          required
          placeholder={preset.appPassword ? 'Password per le app' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {preset.passwordHint && <p className="px-1 text-[12px] text-muted">{preset.passwordHint}</p>}
        {preset.appPassword && (
          <button type="button" onClick={() => call('app:openExternal', preset.appPassword!.url)} className="flex items-center gap-1.5 px-1 text-[12px] text-accent hover:underline">
            {preset.appPassword.label} <ExternalLink size={11} />
          </button>
        )}
        {manual && (
          <>
            <input className={input} placeholder="Nome mostrato ai destinatari (opzionale)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <input className={input} placeholder="Username (se diverso dall'email)" value={username} onChange={(e) => setUsername(e.target.value)} />
          </>
        )}
      </div>

      {!manual && (
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="mt-5 flex items-center gap-1 text-[12px] text-muted hover:text-fg">
          Impostazioni avanzate <ChevronDown size={13} className={`transition ${advanced ? 'rotate-180' : ''}`} />
        </button>
      )}

      <AnimatePresence initial={false}>
        {advanced && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <ServerFields label="Posta in arrivo (IMAP)" value={imap} onChange={setImap} inputClass={input} />
            <ServerFields label="Posta in uscita (SMTP)" value={smtp} onChange={setSmtp} inputClass={input} />
            {!smtpChanged && preset.smtpFallbacks?.length ? (
              <p className="mt-2 px-1 text-[11.5px] text-faint">
                Se la porta {preset.smtp.port} è bloccata viene usata automaticamente la{' '}
                {preset.smtpFallbacks.map((f) => `${f.port}${f.secure ? ' (SSL)' : ' (STARTTLS)'}`).join(', ')}.
              </p>
            ) : null}
            {!manual && (
              <input className={`${input} mt-3`} placeholder="Nome mostrato ai destinatari (opzionale)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[12.5px]">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <div className="font-semibold text-danger">
              {error.title ?? 'Connessione non riuscita'}
              {error.stage && <span className="ml-1.5 font-normal text-muted">· {error.stage === 'imap' ? 'IMAP' : 'SMTP'}</span>}
            </div>
            <div className="mt-0.5 text-fg/80">{error.message}</div>
          </div>
        </motion.div>
      )}

      <button
        type="submit"
        disabled={busy || !email || !password || !imap.host || !smtp.host}
        className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13.5px] font-medium text-white transition hover:bg-accent-strong active:scale-[0.99] disabled:opacity-50"
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {busy ? 'Verifica di IMAP e SMTP…' : 'Aggiungi account'}
      </button>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-faint">
        <Lock size={11} /> La password viene cifrata con Windows (DPAPI) e resta su questo PC. {BRAND.name} non la invia altrove.
      </p>
    </form>
  )
}

function ServerFields(props: { label: string; value: ServerFieldsState; onChange: (v: ServerFieldsState) => void; inputClass: string }) {
  const { label, value, onChange } = props
  // Qui la larghezza la decide il flex: host elastico, porta fissa.
  const inputClass = props.inputClass.replace('w-full', '')
  return (
    <div className="mt-4">
      <div className="mb-2 text-[11.5px] font-medium text-muted">{label}</div>
      <div className="flex gap-2">
        <input className={`${inputClass} min-w-0 flex-1`} placeholder="host" value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value })} required />
        <input
          className={`${inputClass} w-24 shrink-0`}
          placeholder="porta"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, '') })}
          required
        />
      </div>
      <label className="mt-2 flex items-center gap-2 px-1 text-[12px] text-muted">
        <input type="checkbox" checked={value.secure} onChange={(e) => onChange({ ...value, secure: e.target.checked })} className="accent-[var(--accent)]" />
        SSL/TLS diretto (disattiva per STARTTLS, es. porta 587)
      </label>
    </div>
  )
}
