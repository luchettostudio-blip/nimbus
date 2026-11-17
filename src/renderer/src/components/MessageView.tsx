import { AnimatePresence, motion } from 'framer-motion'
import { AlarmClock, Archive, Forward, ImageOff, Mail, MailOpen, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import { snoozePresets } from '../lib/schedule'
import { TimeMenu } from './TimeMenu'
import { AttachmentStrip } from './viewer/AttachmentStrip'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { call } from '../lib/api'
import { avatarHue, displayName, formatAddress, initials, longDate } from '../lib/format'
import { buildEmailDocument, sanitizeEmail } from '../lib/sanitize'
import { currentMessage, useStore } from '../store'

export function MessageView() {
  const msg = useStore((s) => currentMessage(s))
  const account = useStore((s) => (s.accounts.length > 1 ? s.accounts.find((a) => a.id === msg?.accountId) : undefined))
  const body = useStore((s) => s.body)
  const bodyLoading = useStore((s) => s.bodyLoading)
  const bodyError = useStore((s) => s.bodyError)
  const { archive, trash, toggleSeen, toggleFlagged, openCompose, snooze, setSnoozeMenu } = useStore.getState()
  const snoozeOpen = useStore((s) => s.snoozeMenuOpen)

  if (!msg) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Mail size={36} strokeWidth={1.2} className="text-faint" />
        <div className="text-[13px] text-muted">Seleziona un messaggio</div>
        <div className="flex gap-3 text-[12px] text-faint">
          <span>
            <kbd>J</kbd> <kbd>K</kbd> naviga
          </span>
          <span>
            <kbd>Ctrl</kbd> <kbd>K</kbd> comandi
          </span>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-5">
        <ToolButton label="Archivia" hotkey="E" onClick={archive}>
          <Archive size={16} />
        </ToolButton>
        <ToolButton label="Elimina" hotkey="#" onClick={trash}>
          <Trash2 size={16} />
        </ToolButton>
        <ToolButton label={msg.seen ? 'Segna come non letto' : 'Segna come letto'} hotkey="U" onClick={toggleSeen}>
          {msg.seen ? <Mail size={16} /> : <MailOpen size={16} />}
        </ToolButton>
        <ToolButton label="Speciale" hotkey="S" onClick={toggleFlagged}>
          <Star size={16} className={msg.flagged ? 'fill-amber-400 text-amber-400' : ''} />
        </ToolButton>
        <div className="relative">
          <ToolButton label="Rimanda" hotkey="H" onClick={() => setSnoozeMenu(!snoozeOpen)}>
            <AlarmClock size={16} />
          </ToolButton>
          <AnimatePresence>
            {snoozeOpen && (
              <TimeMenu title="Rimanda fino a…" presets={snoozePresets()} onPick={(at) => snooze(at)} onClose={() => setSnoozeMenu(false)} placement="down" />
            )}
          </AnimatePresence>
        </div>
        <div className="flex-1" />
        <ToolButton label="Rispondi" hotkey="R" onClick={() => openCompose('reply')}>
          <Reply size={16} />
        </ToolButton>
        <ToolButton label="Rispondi a tutti" hotkey="A" onClick={() => openCompose('replyAll')}>
          <ReplyAll size={16} />
        </ToolButton>
        <ToolButton label="Inoltra" hotkey="F" onClick={() => openCompose('forward')}>
          <Forward size={16} />
        </ToolButton>
      </header>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${msg.accountId}|${msg.folder}|${msg.uid}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="flex-1 overflow-y-auto px-8 pb-10"
        >
          <h2 className="selectable mb-5 mt-2 text-[22px] font-semibold leading-tight tracking-[-0.01em]">{msg.subject}</h2>

          <div className="mb-6 flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
              style={{ background: `hsl(${avatarHue(msg.from)} 55% 50%)` }}
            >
              {initials(msg.from)}
            </div>
            <div className="selectable min-w-0 flex-1 text-[13px]">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{displayName(msg.from)}</span>
                <span className="truncate text-muted">{msg.from?.address}</span>
              </div>
              <div className="truncate text-muted">
                a {msg.to.map(formatAddress).join(', ') || '—'}
                {body && body.cc.length > 0 && <> · cc {body.cc.map(formatAddress).join(', ')}</>}
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] text-faint">
              {longDate(msg.date)}
              {account && <div className="mt-0.5 text-[11px]">in {account.email}</div>}
            </div>
          </div>

          {bodyLoading && !body && <BodySkeleton />}
          {bodyError && <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-[13px] text-danger">{bodyError}</div>}
          {body && <EmailBody html={body.html} text={body.text} />}

          {body && <AttachmentStrip accountId={msg.accountId} folder={msg.folder} uid={msg.uid} attachments={body.attachments} />}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

function ToolButton({ label, hotkey, onClick, children }: { label: string; hotkey: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={`${label}  (${hotkey})`}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg active:scale-95"
    >
      {children}
    </button>
  )
}

function BodySkeleton() {
  return (
    <div className="space-y-2.5">
      {[92, 80, 86, 60].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

/**
 * Corpo email in un iframe sandbox (niente script, niente navigazione).
 * Le immagini remote sono bloccate finché l'utente non clicca "Mostra immagini".
 */
function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  if (!html) return <PlainTextBody text={text ?? ''} />
  return <HtmlBody html={html} />
}

/** Messaggi solo testo: resi nativamente con i colori del tema, link cliccabili. */
function PlainTextBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+)/g)
  return (
    <div className="selectable whitespace-pre-wrap break-words text-[14px] leading-relaxed text-fg/90">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} onClick={(e) => (e.preventDefault(), void call('app:openExternal', p))} className="text-accent hover:underline">
            {p}
          </a>
        ) : (
          p
        )
      )}
    </div>
  )
}

function HtmlBody({ html }: { html: string }) {
  const [allowRemote, setAllowRemote] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  const { doc, blocked } = useMemo(() => {
    const { html: clean, blockedCount } = sanitizeEmail(html, allowRemote)
    return { doc: buildEmailDocument(clean, allowRemote), blocked: blockedCount }
  }, [html, allowRemote])

  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observerRef.current?.disconnect(), [])

  const onLoad = () => {
    const d = iframeRef.current?.contentDocument
    if (!d) return
    // Altezza del contenuto (non della viewport), aggiornata al frame successivo
    // e solo se cambia: evita il loop "ResizeObserver loop completed".
    let frame = 0
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const h = Math.max(120, Math.ceil(d.documentElement.getBoundingClientRect().height))
        setHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev))
      })
    }
    resize()
    observerRef.current?.disconnect()
    observerRef.current = new ResizeObserver(resize)
    observerRef.current.observe(d.documentElement)
    d.querySelectorAll('img').forEach((img) => img.addEventListener('load', resize))
    // I link si aprono nel browser di sistema.
    d.addEventListener('click', (e) => {
      const a = (e.target as Element).closest('a')
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href')
      if (href) void call('app:openExternal', href)
    })
  }

  return (
    <div>
      {blocked > 0 && !allowRemote && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-muted">
          <ImageOff size={14} />
          <span className="flex-1">Immagini esterne bloccate per proteggere la tua privacy.</span>
          <button onClick={() => setAllowRemote(true)} className="font-medium text-accent hover:underline">
            Mostra immagini
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-line">
        <iframe
          ref={iframeRef}
          title="Contenuto email"
          sandbox="allow-same-origin"
          srcDoc={doc}
          onLoad={onLoad}
          style={{ height, width: '100%', border: 0, display: 'block', colorScheme: 'light' }}
        />
      </div>
    </div>
  )
}
