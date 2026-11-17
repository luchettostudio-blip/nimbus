import { useRef, useState } from 'react'

/**
 * Anteprima isolata di una firma (iframe sandbox senza script), su sfondo chiaro o scuro.
 * Lo sfondo scuro simula i client in dark mode: il testo senza colore esplicito diventa chiaro.
 */
export function SignaturePreview({ html, dark = false, className = '' }: { html: string; dark?: boolean; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(60)
  const bg = dark ? '#1f1f22' : '#ffffff'
  const fg = dark ? '#e8e8ea' : '#222222'

  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>html,body{margin:0;background:${bg};color:${fg};overflow:hidden;}body{padding:14px 16px;font:13px Arial,Helvetica,sans-serif;}img{max-width:100%;}</style>
</head><body>${html || `<span style="color:#999">Nessuna firma</span>`}</body></html>`

  const measure = () => {
    const d = ref.current?.contentDocument
    if (!d) return
    setHeight(Math.max(48, Math.ceil(d.documentElement.getBoundingClientRect().height)))
  }

  return (
    <iframe
      ref={ref}
      title="Anteprima firma"
      sandbox="allow-same-origin"
      srcDoc={doc}
      onLoad={() => {
        measure()
        // Le immagini (data URI) possono finire di decodificarsi dopo il load del documento.
        ref.current?.contentDocument?.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure))
      }}
      className={`block w-full rounded-lg border border-line ${className}`}
      style={{ height, background: bg, colorScheme: dark ? 'dark' : 'light' }}
    />
  )
}
