import { app, BrowserWindow, nativeTheme, Notification, powerMonitor, shell } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import brand from '../../brand/brand.json'
import { MailStore } from '../core/store/MailStore'
import { SyncEngine } from '../core/sync/SyncEngine'
import type { ThemeMode } from '../shared/ipc'
import { SafeCredentialStore } from './credentials'
import { registerIpc } from './ipc'
import { notifyMissedSends, notifyNewMail, notifySendFailed, notifySnoozeWoke, notifyStillSending } from './notifications'
import { AppTray, applyLaunchAtLogin, startedHidden } from './tray'
import { nativeImageProcessor } from './platform/images'
import { postOneClick } from './platform/download'

let mainWindow: BrowserWindow | null = null
/** true quando l'utente ha scelto davvero di uscire (non solo di chiudere la finestra). */
let isQuitting = false
let trayHintShown = false
/** Callback impostata dopo l'avvio: decide se la chiusura va nella tray. */
let shouldHideOnClose: () => boolean = () => false

const TITLEBAR_HEIGHT = 40

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors
  // Sfondo trasparente: lascia vedere l'effetto Mica sotto i pulsanti nativi.
  return { color: '#00000000', symbolColor: dark ? '#e6e6e6' : '#1a1a1a', height: TITLEBAR_HEIGHT }
}

/** Mica è disponibile solo da Windows 11 (build 22000) in poi. */
function supportsMica(): boolean {
  if (process.platform !== 'win32') return false
  const build = Number(release().split('.')[2] ?? 0)
  return build >= 22000
}

/** Sfondo pieno usato quando il Mica non è disponibile (o la trasparenza è disattivata). */
function solidBackground(): string {
  return nativeTheme.shouldUseDarkColors ? brand.colors.dark.surfaceSolid : brand.colors.light.surfaceSolid
}

function createWindow(): BrowserWindow {
  const mica = supportsMica()
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: brand.name,
    // In sviluppo l'icona della finestra; nell'app installata la prende dall'.exe.
    icon: app.isPackaged ? undefined : join(__dirname, '../../brand', brand.iconPng),
    // Finestra senza cornice: barra del titolo disegnata in React,
    // pulsanti min/max/close nativi di Windows tramite titleBarOverlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    // Effetto Mica di Windows 11 (richiede sfondo trasparente).
    backgroundMaterial: mica ? 'mica' : 'none',
    backgroundColor: mica ? '#00000000' : solidBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  // Avviato da Windows all'accensione: resta nascosto nella tray.
  win.once('ready-to-show', () => !startedHidden() && win.show())

  // Chiudere la finestra la riduce nella tray: invii programmati e sync continuano.
  win.on('close', (e) => {
    if (isQuitting || !shouldHideOnClose()) return
    e.preventDefault()
    win.hide()
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true
      new Notification({ title: `${brand.name} è ancora attivo`, body: 'Continua nella barra delle applicazioni: gli invii programmati partiranno comunque.' }).show()
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => console.error('[main] renderer terminato:', d.reason))
  if (!app.isPackaged) {
    // In sviluppo gli errori del renderer compaiono anche nel terminale.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') console.error('[renderer]', e.message)
    })
    win.webContents.on('did-finish-load', () => console.log('[main] renderer caricato'))
  }

  // Qualsiasi link esterno si apre nel browser di sistema, mai dentro l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Mostra (e porta in primo piano) la finestra; opzionalmente apre una vista. */
function showWindow(nav?: { view: 'scheduled' | 'snoozed' }): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  const win = mainWindow
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (nav) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('app:navigate', nav))
    else win.webContents.send('app:navigate', nav)
  }
}

// Una sola istanza: un secondo avvio porta in primo piano la finestra esistente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  let engine: SyncEngine | null = null
  let store: MailStore | null = null

  app.whenReady().then(() => {
    app.setAppUserModelId(brand.appId) // necessario per le notifiche native su Windows

    const dataDir = app.getPath('userData')
    store = new MailStore(join(dataDir, 'mail.db'))
    engine = new SyncEngine(store, new SafeCredentialStore(join(dataDir, 'credentials.json')), {
      images: nativeImageProcessor,
      dataDir,
      postOneClick,
      openExternal: (url) => shell.openExternal(url)
    })

    nativeTheme.themeSource = store.getSetting<ThemeMode>('theme', 'system')
    nativeTheme.on('updated', () => {
      mainWindow?.setTitleBarOverlay(overlayColors())
      if (!supportsMica()) mainWindow?.setBackgroundColor(solidBackground())
    })

    registerIpc(engine, store, () => mainWindow)

    const s = store
    const eng = engine
    shouldHideOnClose = () => s.getSettings().closeToTray
    applyLaunchAtLogin(s.getSettings().launchAtLogin)

    const tray = new AppTray({
      show: () => showWindow(),
      showScheduled: () => showWindow({ view: 'scheduled' }),
      scheduledCount: () => eng.outbox.list().length,
      quit: () => {
        isQuitting = true
        app.quit()
      }
    })

    engine.onEvent((e) => {
      mainWindow?.webContents.send('sync:event', e)
      if (e.type === 'new-mail') {
        // Di default le notifiche di Windows arrivano solo per la scheda Persone.
        const st = s.getSettings()
        const msgs = st.splitInbox && st.notifyOnlyPeople ? e.messages.filter((m) => (m.category ?? 'people') === 'people') : e.messages
        if (msgs.length) notifyNewMail({ ...e, messages: msgs }, mainWindow)
      }
      if (e.type === 'outbox') tray.refresh()
      if (e.type === 'snooze-woke') notifySnoozeWoke(e, () => showWindow())
      if (e.type === 'unsub-still-sending') notifyStillSending(e.name || e.address, () => showWindow())
      if (e.type === 'outbox-missed') notifyMissedSends(e.count, () => showWindow({ view: 'scheduled' }))
      if (e.type === 'outbox-failed' && e.kind === 'scheduled') notifySendFailed(e.error, () => showWindow({ view: 'scheduled' }))
    })

    // Dopo la sospensione/ripresa del PC le connessioni IMAP sono quasi sempre morte.
    powerMonitor.on('resume', () => engine?.reconnectAll())

    mainWindow = createWindow()
    void engine.startAll()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    void engine?.stopAll()
  })

  app.on('will-quit', () => {
    store?.close()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
