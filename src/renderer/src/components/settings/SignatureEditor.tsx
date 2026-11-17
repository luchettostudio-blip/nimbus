import { Bold, Code2, Image as ImageIcon, Italic, Link2, Loader2, Type, Underline } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SignatureImage } from '@core/models'
import { call } from '../../lib/api'
import { dataUrlToBytes, inlineStyles, sanitizeSignature, toEmailCompatible } from '../../lib/signatureHtml'

/**
 * Editor visuale della firma (contentEditable + execCommand con stili inline)
 * con modalità "HTML" per incollare una firma già fatta.
 * `value`/`onChange` usano l'HTML "da editor": immagini come data URI con data-cid.
 */
export function SignatureEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [htmlMode, setHtmlMode] = useState(false)
  const [htmlText, setHtmlText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const savedRange = useRef<Range | null>(null)

  // Sincronizza il contenuto solo quando cambia dall'esterno (es. si sceglie un'altra firma).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value
  }, [value, htmlMode])

  const emit = () => ref.current && onChange(ref.current.innerHTML)

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(cmd, false, arg)
    emit()
  }

  /** Pulisce HTML esterno e incorpora le sue immagini come CID. */
  const importHtml = async (raw: string): Promise<string> => {
    const inlined = await inlineStyles(raw)
    const clean = sanitizeSignature(inlined)
    return embedImages(clean)
  }

  const onPaste = async (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData('text/html')
    if (!html) return // testo semplice: comportamento standard
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const ready = await importHtml(html)
      ref.current?.focus()
      document.execCommand('insertHTML', false, ready)
      emit()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onImage = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const img = await call('signatures:addImage', new Uint8Array(await file.arrayBuffer()), file.type)
      ref.current?.focus()
      document.execCommand('insertHTML', false, imgTag(img))
      emit()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleHtml = async () => {
    if (!htmlMode) {
      // Nel sorgente mostra cid: invece dei data URI (illeggibili).
      setHtmlText(value.replace(/src="data:[^"]+" data-cid="([^"]+)"/g, 'src="cid:$1"'))
      setHtmlMode(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Ripristina le immagini già note, poi pulisce e incorpora le nuove.
      const known = new Map([...value.matchAll(/src="(data:[^"]+)" data-cid="([^"]+)"/g)].map((m) => [m[2], m[1]]))
      const restored = htmlText.replace(/src="cid:([^"]+)"/g, (all, cid) => (known.has(cid) ? `src="${known.get(cid)}" data-cid="${cid}"` : all))
      const ready = await importHtml(restored)
      onChange(toEmailCompatible(ready))
      setHtmlMode(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const btn = 'flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-fg'

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        {!htmlMode && (
          <>
            <button type="button" title="Grassetto (Ctrl+B)" className={btn} onMouseDown={(e) => (e.preventDefault(), exec('bold'))}>
              <Bold size={14} />
            </button>
            <button type="button" title="Corsivo (Ctrl+I)" className={btn} onMouseDown={(e) => (e.preventDefault(), exec('italic'))}>
              <Italic size={14} />
            </button>
            <button type="button" title="Sottolineato" className={btn} onMouseDown={(e) => (e.preventDefault(), exec('underline'))}>
              <Underline size={14} />
            </button>
            <button
              type="button"
              title="Link"
              className={btn}
              onMouseDown={(e) => {
                e.preventDefault()
                const sel = document.getSelection()
                savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
                setLinkUrl('https://')
              }}
            >
              <Link2 size={14} />
            </button>
            <label title="Colore del testo" className={`${btn} relative cursor-pointer`}>
              <span className="text-[13px] font-bold underline decoration-2">A</span>
              <input type="color" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => exec('foreColor', e.target.value)} />
            </label>
            <label title="Dimensione del testo" className="ml-0.5 flex items-center gap-1 text-muted">
              <Type size={13} />
              <select
                className="h-7 rounded-md bg-transparent text-[12px] outline-none hover:bg-hover"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) exec('fontSize', e.target.value)
                  e.target.value = ''
                }}
              >
                <option value="">Dimensione</option>
                <option value="1">Piccolissimo</option>
                <option value="2">Piccolo</option>
                <option value="3">Normale</option>
                <option value="4">Grande</option>
                <option value="5">Molto grande</option>
              </select>
            </label>
            <button type="button" title="Immagine o logo (max 300px, incorporato)" className={btn} onClick={() => fileRef.current?.click()}>
              <ImageIcon size={14} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onImage(f)
                e.target.value = ''
              }}
            />
          </>
        )}
        <div className="flex-1" />
        {busy && <Loader2 size={14} className="mr-1 animate-spin text-muted" />}
        <button
          type="button"
          onClick={toggleHtml}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition ${htmlMode ? 'bg-accent text-white' : 'text-muted hover:bg-hover hover:text-fg'}`}
        >
          <Code2 size={13} /> {htmlMode ? 'Applica HTML' : 'HTML'}
        </button>
      </div>

      {linkUrl !== null && (
        <form
          className="flex items-center gap-2 border-b border-line px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const url = linkUrl.trim()
            if (/^(https?:\/\/.+|mailto:.+|tel:.+)/i.test(url)) {
              const sel = document.getSelection()
              ref.current?.focus()
              if (savedRange.current && sel) {
                sel.removeAllRanges()
                sel.addRange(savedRange.current)
              }
              // Senza testo selezionato inserisce l'indirizzo stesso come testo del link.
              if (savedRange.current?.collapsed) exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/^mailto:/i, '').replace(/</g, '&lt;')}</a>`)
              else exec('createLink', url)
            }
            setLinkUrl(null)
          }}
        >
          <Link2 size={13} className="text-muted" />
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setLinkUrl(null)}
            className="h-7 flex-1 rounded-md border border-line bg-transparent px-2 text-[12px] outline-none focus:border-accent/60"
            placeholder="https://… oppure mailto:…"
          />
          <button type="submit" className="h-7 rounded-md bg-accent px-2.5 text-[12px] text-white">
            Inserisci
          </button>
        </form>
      )}

      {htmlMode ? (
        <textarea
          className="selectable block h-56 w-full resize-y bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none"
          value={htmlText}
          onChange={(e) => setHtmlText(e.target.value)}
          spellCheck={false}
          placeholder="Incolla qui l'HTML della firma. Stili e immagini vengono convertiti per Gmail e Outlook."
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onPaste={onPaste}
          onBlur={() => ref.current && onChange(ref.current.innerHTML)}
          className="selectable min-h-36 bg-white p-4 text-[13px] text-[#222] outline-none [&_a]:text-[#1a56db] [&_a]:underline"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif', colorScheme: 'light' }}
        />
      )}
      {error && <div className="border-t border-line px-3 py-2 text-[12px] text-danger">{error}</div>}
    </div>
  )
}

function imgTag(img: SignatureImage): string {
  return `<img src="${img.dataUrl}" data-cid="${img.cid}" width="${img.width}" alt="" style="border:0;max-width:300px;height:auto;">`
}

/** Incorpora come CID le immagini remote (http) o data URI senza cid. */
async function embedImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (img.getAttribute('data-cid')) continue
    const src = img.getAttribute('src') ?? ''
    let res: SignatureImage | null = null
    try {
      if (/^https?:/i.test(src)) res = await call('signatures:importImage', src)
      else if (/^data:image\//i.test(src)) {
        const { bytes, mime } = dataUrlToBytes(src)
        res = await call('signatures:addImage', bytes, mime)
      }
    } catch {
      res = null
    }
    if (res) {
      img.setAttribute('src', res.dataUrl)
      img.setAttribute('data-cid', res.cid)
      img.setAttribute('width', String(res.width))
    } else {
      img.remove() // immagini non scaricabili o link esterni non vengono lasciati come link remoti
    }
  }
  return doc.body.innerHTML
}
