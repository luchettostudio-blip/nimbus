/**
 * Icona nella system tray di Windows e avvio automatico.
 *
 * Con "chiudi nella tray" attivo, chiudere la finestra la nasconde soltanto:
 * il main process continua a sincronizzare e a inviare i messaggi programmati.
 */
import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import brand from '../../brand/brand.json'

export function applyLaunchAtLogin(enabled: boolean): void {
  // In sviluppo non registra l'eseguibile di Electron all'avvio di Windows.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

/** true se Windows ha avviato Nimbus all'accensione (va tenuto nascosto nella tray). */
export function startedHidden(): boolean {
  return process.argv.includes('--hidden')
}

export function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, brand.iconPng) : join(__dirname, '../../brand', brand.iconPng)
}

export interface TrayActions {
  show(): void
  showScheduled(): void
  scheduledCount(): number
  quit(): void
}

export class AppTray {
  private tray: Tray

  constructor(private readonly actions: TrayActions) {
    const icon = nativeImage.createFromPath(trayIconPath()).resize({ width: 32, height: 32 })
    this.tray = new Tray(icon)
    this.tray.setToolTip(brand.name)
    this.tray.on('click', () => actions.show())
    this.refresh()
  }

  /** Aggiorna il menu (es. il numero di invii programmati). */
  refresh(): void {
    const n = this.actions.scheduledCount()
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Apri ${brand.name}`, click: () => this.actions.show() },
        { label: n ? `In programma (${n})` : 'Nessun invio programmato', enabled: n > 0, click: () => this.actions.showScheduled() },
        { type: 'separator' },
        { label: `Esci da ${brand.name}`, click: () => this.actions.quit() }
      ])
    )
    this.tray.setToolTip(n ? `${brand.name} · ${n} in programma` : brand.name)
  }

  destroy(): void {
    this.tray.destroy()
  }
}
