import type { ProviderPreset } from '@core/models'

/**
 * Logo del provider: file in `src/renderer/src/assets/providers/<preset.logo>`.
 * Se il file non esiste si mostra un monogramma colorato.
 */
const LOGOS = import.meta.glob('../assets/providers/*.{svg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

function logoUrl(file?: string): string | undefined {
  if (!file) return undefined
  return LOGOS[`../assets/providers/${file}`]
}

export function ProviderLogo({ preset, size = 40 }: { preset: ProviderPreset; size?: number }) {
  const url = logoUrl(preset.logo)
  if (url) {
    return <img src={url} width={size} height={size} alt="" draggable={false} className="shrink-0 rounded-xl object-contain" />
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl font-semibold text-white"
      style={{ width: size, height: size, background: preset.color, fontSize: size * (preset.monogram.length > 1 ? 0.34 : 0.45) }}
    >
      {preset.monogram}
    </div>
  )
}
