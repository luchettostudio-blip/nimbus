import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileIcon, Loader2, Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { call } from '../../lib/api'
import { decodeText, loadAttachment, previewKind, type LoadedAttachment } from '../../lib/attachments'
import { formatBytes } from '../../lib/format'
import { useStore } from '../../store'
import { PdfView } from './PdfView'

/**
 * Overlay a tutto schermo con sfondo sfocato. Esc chiude, ←/→ allegato precedente/successivo,
 * +/− zoom. Tutto è mostrato senza eseguire nulla del file (immagini, canvas PDF, testo).
 */
export function AttachmentViewer() {
  // Durante l'animazione di uscita lo stato è già null: si mostra l'ultimo valore.
  const live = useStore((s) => s.viewer)
  const lastRef = useRef(live!)
  if (live) lastRef.current = live
  const viewer = lastRef.current
  const close = useStore((s) => s.closeViewer)
  const move = useStore((s) => s.moveViewer)
  const toast = useStore((s) => s.toast)
  const info = viewer.attachments[viewer.index]
  const kind = previewKind(info)
  const [loaded, setLoaded] = useState<LoadedAttachment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    setLoaded(null)
    setError(null)
    setZoom(1)
    loadAttachment(viewer.accountId, viewer.folder, viewer.uid, info).then(setLoaded, (e) => setError(e.message))
  }, [viewer.accountId, viewer.folder, viewer.uid, info])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const handled: Record<string, () => void> = {
        Escape: close,
        ArrowRight: () => move(1),
        ArrowLeft: () => move(-1),
        '+': () => setZoom((z) => Math.min(6, z * 1.25)),
        '=': () => setZoom((z) => Math.min(6, z * 1.25)),
        '-': () => setZoom((z) => Math.max(0.25, z / 1.25)),
        '0': () => setZoom(1)
      }
      const h = handled[e.key]
      if (h) {
        e.preventDefault()
        e.stopPropagation()
        h()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, move])

  const ref = [viewer.accountId, viewer.folder, viewer.uid, info.index] as const
  const openExternal = () => call('attachments:open', ...ref).catch((e) => toast(e.message, 'error'))
  const save = () =>
    call('attachments:save', ...ref).then(
      (ok) => ok && toast('Allegato salvato'),
      (e) => toast(e.message, 'error')
    )

  const btn = 'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-white/80 transition hover:bg-white/10 hover:text-white'
  const multiple = viewer.attachments.length > 1

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[70] flex flex-col bg-black/60 text-white backdrop-blur-xl"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <header className="drag flex h-12 shrink-0 items-center gap-2 pl-4 pr-[150px]">
        <div className="no-drag min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{info.filename}</div>
          <div className="text-[11px] text-white/50">
            {formatBytes(info.size)}
            {multiple && ` · ${viewer.index + 1} di ${viewer.attachments.length}`}
          </div>
        </div>
        <div className="no-drag flex items-center gap-1">
          {(kind === 'image' || kind === 'pdf') && (
            <>
              <button className={btn} onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} title="Riduci (−)">
                <Minus size={14} />
              </button>
              <span className="w-12 text-center text-[12px] tabular-nums text-white/60">{Math.round(zoom * 100)}%</span>
              <button className={btn} onClick={() => setZoom((z) => Math.min(6, z * 1.25))} title="Ingrandisci (+)">
                <Plus size={14} />
              </button>
            </>
          )}
          <button className={btn} onClick={openExternal} title="Apri con l'app predefinita di Windows">
            <ExternalLink size={14} /> Apri
          </button>
          <button className={btn} onClick={save} title="Salva sul PC">
            <Download size={14} /> Salva
          </button>
          <button className={btn} onClick={close} title="Chiudi (Esc)">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-stretch px-14 pb-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        {multiple && (
          <>
            <NavButton side="left" onClick={() => move(-1)} />
            <NavButton side="right" onClick={() => move(1)} />
          </>
        )}
        {error ? (
          <Fallback name={info.filename} message={error} onOpen={openExternal} onSave={save} />
        ) : !loaded ? (
          <Loader2 className="m-auto animate-spin text-white/60" />
        ) : kind === 'image' ? (
          <ImageView url={loaded.url!} zoom={zoom} setZoom={setZoom} onError={() => setError('Formato immagine non supportato dall’anteprima.')} />
        ) : kind === 'pdf' ? (
          <PdfView data={loaded.data} zoom={zoom} />
        ) : kind === 'text' ? (
          <pre className="selectable mx-auto w-full max-w-5xl overflow-auto rounded-xl bg-black/50 p-5 font-mono text-[12.5px] leading-relaxed text-white/90">
            {decodeText(loaded.data, info.filename)}
          </pre>
        ) : (
          <Fallback name={info.filename} message="Anteprima non disponibile per questo tipo di file." onOpen={openExternal} onSave={save} />
        )}
      </div>
    </motion.div>
  )
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      title={side === 'left' ? 'Precedente (←)' : 'Successivo (→)'}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 transition hover:bg-white/20 ${side === 'left' ? 'left-3' : 'right-3'}`}
    >
      <Icon size={20} />
    </button>
  )
}

/** Immagine con zoom (rotella, +/−) e trascinamento quando ingrandita. Doppio clic = adatta. */
function ImageView({ url, zoom, setZoom, onError }: { url: string; zoom: number; setZoom: (f: (z: number) => number) => void; onError: () => void }) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => setPan({ x: 0, y: 0 }), [url])
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden"
      onWheel={(e) => setZoom((z) => Math.min(6, Math.max(0.25, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))))}
      onMouseDown={(e) => {
        if (zoom <= 1) return
        drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      }}
      onMouseMove={(e) => {
        const d = drag.current
        if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
      }}
      onMouseUp={() => (drag.current = null)}
      onMouseLeave={() => (drag.current = null)}
      onDoubleClick={() => setZoom(() => 1)}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        onError={onError}
        className="max-h-full max-w-full select-none object-contain shadow-2xl"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'zoom-in', transition: drag.current ? 'none' : 'transform 120ms ease-out' }}
      />
    </div>
  )
}

function Fallback({ name, message, onOpen, onSave }: { name: string; message: string; onOpen: () => void; onSave: () => void }) {
  const ext = name.split('.').pop()?.toUpperCase().slice(0, 5) ?? ''
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <div className="relative">
        <FileIcon size={84} strokeWidth={1} className="text-white/70" />
        <span className="absolute inset-x-0 bottom-5 text-[13px] font-bold tracking-wide">{ext}</span>
      </div>
      <div>
        <div className="text-[15px] font-medium">{name}</div>
        <div className="mt-1 text-[12.5px] text-white/60">{message}</div>
      </div>
      <div className="flex gap-2">
        <button onClick={onOpen} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[13px] font-medium text-black hover:bg-white/90">
          <ExternalLink size={14} /> Apri con app predefinita
        </button>
        <button onClick={onSave} className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-[13px] font-medium hover:bg-white/25">
          <Download size={14} /> Salva
        </button>
      </div>
    </div>
  )
}
