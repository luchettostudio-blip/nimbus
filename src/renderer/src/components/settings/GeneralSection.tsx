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

      <Group title="Posta">
        <Row label="Conversazioni in thread" hint="Raggruppa le risposte (anche le tue) in un'unica conversazione in stile chat.">
          <Toggle checked={settings.threads} onChange={(v) => update({ threads: v })} />
        </Row>
        <Row label="Posta in arrivo divisa" hint="Schede Persone, Newsletter e Notifiche (tasti 1, 2, 3). Niente viene spostato sul server.">
          <Toggle checked={settings.splitInbox} onChange={(v) => update({ splitInbox: v })} />
        </Row>
        <Row label="Notifiche solo per Persone" hint="Le notifiche di Windows arrivano solo per le mail della scheda Persone.">
          <Toggle checked={settings.notifyOnlyPeople} onChange={(v) => update({ notifyOnlyPeople: v })} />
        </Row>
      </Group>

      <Group title="Ricerca">
        <Row label="Mail da indicizzare" hint="Nimbus scarica in background il testo delle mail di questo periodo per la ricerca istantanea.">
          <select
            value={settings.indexMonths}
            onChange={(e) => update({ indexMonths: Number(e.target.value) })}
            className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none"
          >
            {[
              [3, 'Ultimi 3 mesi'],
              [6, 'Ultimi 6 mesi'],
              [12, 'Ultimi 12 mesi'],
              [24, 'Ultimi 2 anni'],
              [60, 'Ultimi 5 anni']
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
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
