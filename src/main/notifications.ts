/**
 * Notifiche native di Windows per i nuovi messaggi.
 * Mostrate solo se la finestra non è in primo piano; il click apre il messaggio.
 */
import { BrowserWindow, Notification } from 'electron'
import type { SyncEvent } from '../core/models'

export function notifyNewMail(event: Extract<SyncEvent, { type: 'new-mail' }>, win: BrowserWindow | null): void {
  if (!Notification.isSupported()) return
  if (win && win.isFocused()) return

  const msgs = event.messages
  if (msgs.length === 0) return

  if (msgs.length > 3) {
    const n = new Notification({ title: `${msgs.length} nuovi messaggi`, body: msgs.slice(0, 3).map((m) => m.subject).join('\n') })
    n.on('click', () => focus(win))
    n.show()
    return
  }

  for (const m of msgs) {
    const n = new Notification({
      title: m.from?.name || m.from?.address || 'Nuovo messaggio',
      subtitle: m.subject,
      body: `${m.subject}\n${m.snippet}`.slice(0, 240)
    })
    n.on('click', () => {
      focus(win)
      win?.webContents.send('app:openMessage', { accountId: m.accountId, folder: m.folder, uid: m.uid })
    })
    n.show()
  }
}

/** Una mail rimandata è tornata in Posta in arrivo. */
export function notifySnoozeWoke(e: Extract<SyncEvent, { type: 'snooze-woke' }>, show: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: `Rimandata · ${e.from?.name || e.from?.address || 'Promemoria'}`,
    body: e.subject
  })
  n.on('click', () => {
    show()
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:openMessage', { accountId: e.accountId, folder: e.folder, uid: e.uid })
  })
  n.show()
}

/** Invii programmati non partiti perché il PC era spento: chiede se inviarli ora. */
export function notifyMissedSends(count: number, open: () => void): void {
  if (!Notification.isSupported() || count === 0) return
  const n = new Notification({
    title: count === 1 ? 'Un invio programmato non è partito' : `${count} invii programmati non sono partiti`,
    body: 'Il PC era spento all’orario previsto. Clicca per scegliere se inviarli ora.'
  })
  n.on('click', open)
  n.show()
}

export function notifySendFailed(error: string, open: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Invio programmato non riuscito', body: error.slice(0, 200) })
  n.on('click', open)
  n.show()
}

function focus(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
