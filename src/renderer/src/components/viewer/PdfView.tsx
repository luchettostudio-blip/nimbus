import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * PDF renderizzato su canvas con pdf.js (nessuno script del PDF viene eseguito:
 * niente scripting né annotazioni interattive). Livello di testo trasparente per la ricerca.
 */
export function PdfView({ data, zoom }: { data: Uint8Array; zoom: number }) {
  const container = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HTMLElement[]>([])
  const [hitIndex, setHitIndex] = useState(0)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Copia: pdf.js trasferisce il buffer al worker e lo renderebbe inutilizzabile.
    const task = pdfjs.getDocument({ data: data.slice(), enableXfa: false })
    task.promise.then(
      (d) => !cancelled && setDoc(d),
      (e) => !cancelled && setError(e?.message ?? 'PDF non leggibile')
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])

  // (Ri)disegna tutte le pagine quando cambia documento o zoom.
  useEffect(() => {
    if (!doc || !container.current) return
    let cancelled = false
    const root = container.current
    root.innerHTML = ''
    setRendering(true)
    ;(async () => {
      const ratio = window.devicePixelRatio || 1
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n)
        const viewport = page.getViewport({ scale: zoom * 1.25 })
        const wrap = document.createElement('div')
        wrap.className = 'pdf-page'
        wrap.style.width = `${viewport.width}px`
        wrap.style.height = `${viewport.height}px`
        wrap.style.setProperty('--scale-factor', String(viewport.scale))
        wrap.style.setProperty('--total-scale-factor', String(viewport.scale))
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        wrap.appendChild(canvas)
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        wrap.appendChild(textDiv)
        root.appendChild(wrap)
        await page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise
        const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport })
        await layer.render()
      }
      if (!cancelled) setRendering(false)
    })().catch((e) => !cancelled && setError(e?.message ?? 'Errore di rendering'))
    return () => {
      cancelled = true
    }
  }, [doc, zoom])

  // Ricerca nel testo: evidenzia gli span del livello di testo che contengono la query.
  useEffect(() => {
    const root = container.current
    if (!root) return
    root.querySelectorAll('.pdf-hit').forEach((el) => el.classList.remove('pdf-hit', 'pdf-hit-active'))
    const q = query.trim().toLowerCase()
    if (!q || rendering) {
      setHits([])
      return
    }
    const found = Array.from(root.querySelectorAll<HTMLElement>('.textLayer span')).filter((s) => s.textContent?.toLowerCase().includes(q))
    found.forEach((el) => el.classList.add('pdf-hit'))
    setHits(found)
    setHitIndex(0)
  }, [query, rendering])

  useEffect(() => {
    hits.forEach((h, i) => h.classList.toggle('pdf-hit-active', i === hitIndex))
    hits[hitIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [hits, hitIndex])

  const step = (d: number) => hits.length && setHitIndex((i) => (i + d + hits.length) % hits.length)

  if (error) return <div className="m-auto text-[13px] text-white/70">Impossibile mostrare il PDF: {error}</div>

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mx-auto mb-3 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-1.5 text-[12.5px] text-white/80">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          placeholder="Cerca nel PDF"
          className="w-48 bg-transparent outline-none placeholder:text-white/40"
        />
        {query && <span className="tabular-nums text-white/50">{hits.length ? `${hitIndex + 1}/${hits.length}` : '0'}</span>}
        <button onClick={() => step(-1)} className="rounded p-0.5 hover:bg-white/10" title="Precedente (Maiusc+Invio)">
          <ChevronUp size={14} />
        </button>
        <button onClick={() => step(1)} className="rounded p-0.5 hover:bg-white/10" title="Successivo (Invio)">
          <ChevronDown size={14} />
        </button>
        {doc && <span className="ml-1 text-white/50">{doc.numPages} pag.</span>}
      </div>
      <div ref={container} className="pdf-pages flex-1 overflow-auto" />
    </div>
  )
}
