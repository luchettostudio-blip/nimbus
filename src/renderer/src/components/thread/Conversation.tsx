import { Expand, Loader2, MoreHorizontal, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageBody, MessageSummary } from '@core/models'
import { call } from '../../lib/api'
import { avatarHue, displayName, initials } from '../../lib/format'
import { repeatedSignatures, splitMessage } from '../../lib/quotes'
import { msgKey, useStore } from '../../store'
import { EmailBody } from '../MessageView'
import { AttachmentStrip } from '../viewer/AttachmentStrip'

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= start) return 'Oggi'
  if (ts >= start - 86_400_000) return 'Ieri'
  const label = dayFmt.format(d)
  return d.getFullYear() === today.getFullYear() ? label : `${label} ${d.getFullYear()}`
}

/** Testo leggibile del messaggio (dall'HTML se manca la parte testuale). */
function textOf(body: MessageBody | undefined, fallback: string): string {
  if (!body) return fallback
  if (body.text?.trim()) return body.text
  if (!body.html) return fallback
  const html = body.html.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '$&\n')
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? fallback).replace(/\n{3,}/g, '\n\n').trim()
}

/** Conversazione in stile chat: io a destra, gli altri a sinistra. */
export function Conversation() {
  const th = useStore((s) => s.thread)
  const me = useStore((s) => s.accounts.find((a) => a.id === s.thread?.accountId)?.email.toLowerCase())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  // Aperto di default: il primo non letto, altrimenti l'ultimo messaggio.
  useEffect(() => {
    if (!th) return
    const firstUnread = th.messages.find((m) => !m.seen)
    const open = firstUnread ?? th.messages[th.messages.length - 1]
    setExpanded(new Set(open ? [msgKey(open)] : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [th?.key, th?.messages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [th?.key])

  const sigs = useMemo(() => {
    if (!th) return new Map<string, string>()
    return repeatedSignatures(th.messages.map((m) => ({ from: m.from?.address ?? '', text: textOf(th.bodies[msgKey(m)], m.snippet) })))
  }, [th])

  if (!th) {
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" /> Carico la conversazione…
      </div>
    )
  }

  let lastDay = ''
  return (
    <div className="pb-4">
      {th.messages.map((m) => {
        const key = msgKey(m)
        const mine = !!me && m.from?.address.toLowerCase() === me
        const day = dayLabel(m.date)
        const showDay = day !== lastDay
        lastDay = day
        return (
          <div key={key}>
            {showDay && (
              <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-faint">
                <div className="h-px flex-1 bg-line" />
                {day}
                <div className="h-px flex-1 bg-line" />
              </div>
            )}
            <Bubble
              msg={m}
              body={th.bodies[key]}
              mine={mine}
              open={expanded.has(key)}
              signature={sigs.get(m.from?.address ?? '')}
              onToggle={() =>
                setExpanded((s) => {
                  const n = new Set(s)
                  if (n.has(key)) n.delete(key)
                  else n.add(key)
                  return n
                })
              }
            />
          </div>
        )
      })}
      <QuickReply />
      <div ref={bottomRef} />
    </div>
  )
}

function Avatar({ msg, mine }: { msg: MessageSummary; mine: boolean }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: mine ? 'var(--accent)' : `hsl(${avatarHue(msg.from)} 55% 50%)` }}
      title={msg.from?.address}
    >
      {initials(msg.from)}
    </div>
  )
}

function Bubble(props: { msg: MessageSummary; body?: MessageBody; mine: boolean; open: boolean; signature?: string; onToggle: () => void }) {
  const { msg, body, mine, open, signature, onToggle } = props
  const [showHidden, setShowHidden] = useState(false)
  const [original, setOriginal] = useState(false)
  const text = textOf(body, msg.snippet)
  const { main, hidden } = splitMessage(text, signature ? [signature] : [])
  const side = mine ? 'flex-row-reverse' : 'flex-row'

  // Messaggio già letto e non aperto: una riga sola.
  if (!open) {
    return (
      <button onClick={onToggle} className={`mb-1.5 flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-hover ${side}`}>
        <Avatar msg={msg} mine={mine} />
        <span className={`shrink-0 text-[12.5px] font-medium ${msg.seen ? 'text-muted' : 'text-fg'}`}>{mine ? 'Io' : displayName(msg.from)}</span>
        <span className={`min-w-0 flex-1 truncate text-[12.5px] text-faint ${mine ? 'text-right' : ''}`}>{main.replace(/\s+/g, ' ')}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">{timeFmt.format(new Date(msg.date))}</span>
      </button>
    )
  }

  return (
    <div className={`mb-3 flex items-start gap-2.5 ${side}`}>
      <Avatar msg={msg} mine={mine} />
      <div className={`flex min-w-0 max-w-[82%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <button onClick={onToggle} className={`mb-1 flex items-baseline gap-2 text-[11.5px] ${mine ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium text-fg">{mine ? 'Io' : displayName(msg.from)}</span>
          <span className="tabular-nums text-faint">{timeFmt.format(new Date(msg.date))}</span>
        </button>
        <div
          className={`selectable min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
            mine ? 'rounded-tr-md bg-accent text-white' : 'rounded-tl-md border border-line bg-surface-2 text-fg'
          }`}
        >
          {original && body?.html ? (
            <div className="-mx-2 -my-1 w-[min(640px,60vw)] text-fg">
              <EmailBody html={body.html} text={body.text} />
            </div>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              <Linkified text={main} mine={mine} />
            </div>
          )}
          {!original && hidden && (
            <>
              <button
                onClick={() => setShowHidden((v) => !v)}
                title={showHidden ? 'Nascondi citazione e firma' : 'Mostra citazione e firma'}
                className={`mt-1.5 flex h-4 items-center rounded px-1.5 ${mine ? 'bg-white/20 hover:bg-white/30' : 'bg-hover hover:bg-line'}`}
              >
                <MoreHorizontal size={13} />
              </button>
              {showHidden && <div className={`mt-2 whitespace-pre-wrap break-words text-[12.5px] ${mine ? 'text-white/75' : 'text-muted'}`}>{hidden}</div>}
            </>
          )}
        </div>
        <div className={`mt-1 flex gap-3 text-[11px] text-faint ${mine ? 'flex-row-reverse' : ''}`}>
          {body?.html && (
            <button onClick={() => setOriginal((v) => !v)} className="hover:text-fg">
              {original ? 'Vista conversazione' : 'Mostra originale'}
            </button>
          )}
        </div>
        {body && body.attachments.length > 0 && (
          <div className={mine ? 'self-end' : ''}>
            <AttachmentStrip accountId={msg.accountId} folder={msg.folder} uid={msg.uid} attachments={body.attachments} />
          </div>
        )}
      </div>
    </div>
  )
}

function Linkified({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            onClick={(e) => (e.preventDefault(), void call('app:openExternal', p))}
            className={`underline ${mine ? 'text-white' : 'text-accent'}`}
          >
            {p}
          </a>
        ) : (
          p
        )
      )}
    </>
  )
}

/** Risposta rapida in fondo; "Espandi" apre il compositore completo col testo già scritto. */
function QuickReply() {
  const quickReply = useStore((s) => s.quickReply)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(220, Math.max(44, ta.scrollHeight))}px`
  }, [text])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    const ok = await quickReply(text)
    setSending(false)
    if (ok) setText('')
  }

  return (
    <div className="mt-4 flex items-end gap-2 rounded-2xl border border-line bg-surface-2 p-2 focus-within:border-accent/50">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
        placeholder="Rispondi a tutti…"
        className="selectable max-h-[220px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] outline-none placeholder:text-faint"
      />
      <button
        onClick={() => (void quickReply(text, true), setText(''))}
        title="Apri nel compositore completo"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-hover hover:text-fg"
      >
        <Expand size={15} />
      </button>
      <button
        onClick={send}
        disabled={!text.trim() || sending}
        title="Invia (Ctrl+Invio)"
        className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-strong disabled:opacity-40"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
      </button>
    </div>
  )
}
