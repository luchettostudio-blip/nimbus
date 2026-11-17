import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ChevronDown, Loader2, MoreHorizontal, PenLine, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatWhen, sendPresets } from '../lib/schedule'
import { toEmailCompatible } from '../lib/signatureHtml'
import { TimeMenu } from './TimeMenu'
import { useStore } from '../store'
import { SignaturePreview } from './SignaturePreview'

const TITLES = { new: 'Nuovo messaggio', reply: 'Rispondi', replyAll: 'Rispondi a tutti', forward: 'Inoltra' }

/**
 * Compositore. Struttura del messaggio inviato:
 *   testo dell'utente → firma (scelta dal menu) → testo citato
 * Firma e citazione restano separate dal testo e vengono composte dal main in HTML compatibile.
 */
export function Composer() {
  // Durante l'animazione di uscita lo stato è già null: si continua a mostrare l'ultimo valore.
  const live = useStore((s) => s.compose)
  const lastRef = useRef(live!)
  if (live) lastRef.current = live
  const compose = lastRef.current
  const update = useStore((s) => s.updateCompose)
  const close = useStore((s) => s.closeCompose)
  const send = useStore((s) => s.send)
  const sendNow = useStore((s) => s.sendScheduledNow)
  const [menuOpen, setMenuOpen] = useState(false)
  const accounts = useStore((s) => s.accounts)
  const signatures = useStore((s) => s.signatures[compose.accountId] ?? [])
  const openSettings = useStore((s) => s.openSettings)
  const [sending, setSending] = useState(false)
  const [showCc, setShowCc] = useState(compose.cc.length > 0)
  const [showQuoted, setShowQuoted] = useState(compose.mode === 'forward')

  const toRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Risposta: cursore nel corpo. Nuovo/inoltra: sul destinatario.
    if (compose.mode === 'reply' || compose.mode === 'replyAll') bodyRef.current?.focus()
    else toRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Il campo di testo cresce col contenuto: firma e citazione restano subito sotto.
  useEffect(() => {
    const ta = bodyRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(140, ta.scrollHeight)}px`
  }, [compose.body])

  const signature = signatures.find((s) => s.id === compose.signatureId)

  const doSend = async (scheduleAt?: number) => {
    if (sending) return
    setMenuOpen(false)
    setSending(true)
    await send(scheduleAt)
    setSending(false)
  }
  const editingScheduled = !!compose.outboxId

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void doSend()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const field = 'w-full bg-transparent py-2.5 text-[13.5px] outline-none placeholder:text-faint'

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      onKeyDown={onKeyDown}
      className="fixed bottom-5 right-5 z-40 flex h-[min(660px,calc(100vh-90px))] w-[min(660px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl shadow-black/40"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-line pl-5 pr-2">
        <span className="flex-1 text-[13px] font-medium">
          {editingScheduled ? 'Modifica invio programmato' : TITLES[compose.mode]}
          {compose.scheduledAt && <span className="ml-2 font-normal text-muted">· {formatWhen(compose.scheduledAt)}</span>}
        </span>
        <button onClick={close} title="Chiudi (Esc)" className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg">
          <X size={15} />
        </button>
      </div>

      <div className="border-b border-line px-5">
        <div className="flex items-center gap-3 border-b border-line">
          <span className="w-10 text-[12px] text-faint">A</span>
          <input ref={toRef} className={field} value={compose.to} onChange={(e) => update({ to: e.target.value })} placeholder="destinatario@esempio.com" />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="text-[12px] text-muted hover:text-fg">
              Cc
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-3 border-b border-line">
            <span className="w-10 text-[12px] text-faint">Cc</span>
            <input className={field} value={compose.cc} onChange={(e) => update({ cc: e.target.value })} />
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="w-10 text-[12px] text-faint">Ogg.</span>
          <input className={`${field} font-medium`} value={compose.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="Oggetto" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <textarea
          ref={bodyRef}
          className="selectable block w-full resize-none overflow-hidden bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-faint"
          value={compose.body}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Scrivi il tuo messaggio…"
        />

        {/* Firma: sopra il testo citato. */}
        <div className="mt-3">
          {signature && <SignaturePreview html={toEmailCompatible(signature.previewHtml)} className="!border-transparent" />}
        </div>

        {compose.quoted && (
          <div className="mt-3">
            <button
              onClick={() => setShowQuoted((v) => !v)}
              title={showQuoted ? 'Nascondi il testo citato' : 'Mostra il testo citato'}
              className="flex h-5 items-center rounded-md bg-surface-2 px-2 text-muted hover:bg-hover"
            >
              <MoreHorizontal size={14} />
            </button>
            {showQuoted && (
              <div className="selectable mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-[13px] leading-relaxed text-muted">
                {compose.quoted.header}
                {'\n'}
                {compose.quoted.text}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex h-14 shrink-0 items-center gap-3 border-t border-line px-4">
        <div className="relative flex">
          <button
            onClick={() => doSend()}
            disabled={sending}
            className="flex h-9 items-center gap-2 rounded-l-xl bg-accent pl-4 pr-3 text-[13px] font-medium text-white transition hover:bg-accent-strong active:scale-[0.98] disabled:opacity-60"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : editingScheduled ? <CalendarClock size={14} /> : <Send size={14} />}
            {editingScheduled ? 'Salva' : 'Invia'}
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Programma invio"
            className="flex h-9 items-center rounded-r-xl border-l border-white/20 bg-accent px-2 text-white transition hover:bg-accent-strong"
          >
            <ChevronDown size={14} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <TimeMenu
                title={editingScheduled ? 'Cambia orario di invio' : 'Programma invio'}
                presets={sendPresets()}
                onPick={(at) => doSend(at)}
                onClose={() => setMenuOpen(false)}
                extra={
                  editingScheduled ? (
                    <button
                      onClick={() => (setMenuOpen(false), void sendNow())}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-[13px] hover:bg-hover"
                    >
                      <Send size={14} className="text-muted" /> Invia ora
                    </button>
                  ) : null
                }
              />
            )}
          </AnimatePresence>
        </div>
        <span className="text-[12px] text-faint">
          <kbd>Ctrl</kbd> <kbd>Enter</kbd>
        </span>

        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-faint" title="Firma">
          <PenLine size={13} />
          <select
            value={compose.signatureId ?? ''}
            onChange={(e) => {
              if (e.target.value === '__manage') openSettings('signatures')
              else update({ signatureId: e.target.value || null })
            }}
            className="max-w-[140px] truncate rounded-md border border-line bg-surface-2 px-1.5 py-1 text-[12px] text-fg outline-none"
          >
            <option value="">Nessuna firma</option>
            {signatures.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__manage">Gestisci firme…</option>
          </select>
        </label>

        <label className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
          da
          {accounts.length > 1 ? (
            <select
              value={compose.accountId}
              onChange={(e) => update({ accountId: e.target.value })}
              className="max-w-[200px] truncate rounded-md border border-line bg-surface-2 px-1.5 py-1 text-[12px] text-fg outline-none"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          ) : (
            <span className="max-w-[200px] truncate">{accounts[0]?.email}</span>
          )}
        </label>
      </div>
    </motion.div>
  )
}
