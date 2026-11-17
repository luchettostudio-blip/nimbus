import logoUrl from '@brand/logo.svg'

/** Logo dell'app (brand/logo.svg). */
export function Logo({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <img src={logoUrl} width={size} height={size} alt="" draggable={false} className={`shrink-0 ${className}`} />
}
