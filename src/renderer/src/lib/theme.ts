/**
 * Applica la palette di brand/brand.json come variabili CSS (--accent, --fg, …).
 * Chiamata una volta all'avvio, prima del primo render, per evitare flash di colori.
 */
import brand from '@brand/brand.json'

type Palette = Record<string, string>

/** surfaceSolid → surface-solid, surface2 → surface-2 */
const toCssName = (k: string) => k.replace(/([A-Z])/g, '-$1').replace(/(\d+)/g, '-$1').toLowerCase()

const toVars = (p: Palette) =>
  Object.entries(p)
    .map(([k, v]) => `--${toCssName(k)}: ${v};`)
    .join('\n  ')

export function applyBrandTheme(): void {
  const style = document.createElement('style')
  style.id = 'brand-theme'
  style.textContent = `
:root {
  color-scheme: dark;
  ${toVars(brand.colors.dark)}
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    ${toVars(brand.colors.light)}
  }
}`
  document.head.prepend(style)
  document.title = brand.name
}

export const BRAND = brand
