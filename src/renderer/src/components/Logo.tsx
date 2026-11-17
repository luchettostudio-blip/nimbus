import logoUrl from '@brand/logo.svg'

/**
 * Logo dell'app (brand/logo.svg) usato come maschera: prende il colore del testo
 * del tema (nero in chiaro, bianco in scuro), così resta leggibile su ogni sfondo.
 */
export function Logo({ size = 16, className = '' }: { size?: number; className?: string }) {
  const mask = `url("${logoUrl}") center / contain no-repeat`
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-fg ${className}`}
      style={{ width: size, height: size, WebkitMask: mask, mask }}
    />
  )
}
