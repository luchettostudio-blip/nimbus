import type { ReactNode } from 'react'
import type { AppSettings } from '@core/models'
import { useStore } from '../../store'

/** Impostazioni > Generali. Ogni funzione aggiunge qui le sue opzioni. */
export function GeneralSection() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  if (!settings) return null

  return (
    <div>
      <h2 className="text-[17px] font-semibold">Generali</h2>
      <p className="mb-5 mt-1 text-[12.5px] text-muted">Le preferenze valgono per tutti gli account.</p>

      <Group title="Invio">
        <Row label="Annulla invio" hint="Per quanti secondi puoi ripensarci dopo aver premuto Invia.">
          <select
            value={settings.undoSendSeconds}
            onChange={(e) => update({ undoSendSeconds: Number(e.target.value) as AppSettings['undoSendSeconds'] })}
            className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none"
          >
            {[5, 10, 20, 30].map((s) => (
              <option key={s} value={s}>
                {s} secondi
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="Finestra e avvio">
        <Row label="Chiudi nella barra delle applicazioni" hint="Chiudendo la finestra Nimbus resta attivo nella tray: sync e invii programmati continuano.">
          <Toggle checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
        </Row>
        <Row label="Avvia Nimbus all'accensione del PC" hint="Parte ridotto nella tray. Attivo solo nell'app installata.">
          <Toggle checked={settings.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} />
        </Row>
      </Group>
    </div>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">{title}</div>
      <div className="divide-y divide-line rounded-xl border border-line">{children}</div>
    </section>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[12px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}
