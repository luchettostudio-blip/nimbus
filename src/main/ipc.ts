/**
 * Handler IPC: traduce le chiamate del renderer in chiamate al SyncEngine.
 * Nessuna logica di dominio qui: solo validazione minima e inoltro.
 */
import { ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron'
import { classifyError, MailSetupError } from '../core/errors'
import type { SyncEngine } from '../core/sync/SyncEngine'
import { listProviders } from './config/providers'
import { applyLaunchAtLogin } from './tray'
import { downloadImage } from './platform/download'
import { openAttachment, readAttachment, saveAttachment } from './attachments'
import type { MailStore } from '../core/store/MailStore'
import type { IpcInvokeMap, IpcResult, InvokeChannel, ThemeMode } from '../shared/ipc'

type Handlers = { [C in InvokeChannel]: (...args: IpcInvokeMap[C]['args']) => IpcInvokeMap[C]['ret'] | Promise<IpcInvokeMap[C]['ret']> }

export function registerIpc(engine: SyncEngine, store: MailStore, getWindow: () => BrowserWindow | null): void {
  const handlers: Handlers = {
    'providers:list': () => listProviders(),

    'accounts:list': () => engine.listAccounts(),
    'accounts:add': (input) => engine.addAccount(input),
    'accounts:remove': (id) => engine.removeAccount(id),

    'folders:list': (id) => engine.listFolders(id),
    'folders:refresh': (id) => engine.refreshFolders(id),
    'folders:inboxes': () => engine.listInboxes(),

    'messages:list': (id, folder) => engine.listMessages(id, folder),
    'messages:sync': (id, folder) => engine.syncFolder(id, folder, false),
    'messages:loadOlder': (id, folder) => engine.loadOlder(id, folder),
    'messages:search': (id, q) => engine.search(id, q),
    'messages:unified': () => engine.listUnifiedInbox(),
    'messages:syncUnified': () => engine.syncAllInboxes(),
    'messages:body': (id, folder, uid) => engine.getBody(id, folder, uid),
    'messages:setSeen': (id, folder, uids, seen) => engine.setSeen(id, folder, uids, seen),
    'messages:setFlagged': (id, folder, uids, flagged) => engine.setFlagged(id, folder, uids, flagged),
    'messages:archive': (id, folder, uids) => engine.archive(id, folder, uids),
    'messages:trash': (id, folder, uids) => engine.trash(id, folder, uids),
    'messages:send': (draft) => engine.sendDraft(draft),

    'outbox:enqueue': (draft, mode, kind, sendAt) => engine.outbox.enqueue(draft, mode, kind, sendAt),
    'outbox:cancel': (id) => engine.outbox.cancel(id),
    'outbox:update': (id, patch) => engine.outbox.update(id, patch),
    'outbox:sendNow': (id) => engine.outbox.sendNow(id),
    'outbox:sendAllMissed': () => engine.outbox.sendAllMissed(),
    'outbox:list': () => engine.outbox.list(),

    'attachments:get': async (id, folder, uid, index) => readAttachment(await engine.getAttachment(id, folder, uid, index)),
    'attachments:open': async (id, folder, uid, index) => openAttachment(await engine.getAttachment(id, folder, uid, index)),
    'attachments:save': async (id, folder, uid, index) => saveAttachment(await engine.getAttachment(id, folder, uid, index), getWindow()),

    'snooze:set': (id, folder, uid, wakeAt) => engine.snoozer.snooze(id, folder, uid, wakeAt),
    'snooze:cancel': (id) => engine.snoozer.cancel(id),
    'snooze:list': () => engine.snoozer.list(),

    'settings:get': () => store.getSettings(),
    'settings:update': (patch) => {
      const next = store.updateSettings(patch)
      if ('launchAtLogin' in patch) applyLaunchAtLogin(next.launchAtLogin)
      return next
    },

    'signatures:list': (id) => engine.signatures.list(id),
    'signatures:save': (input) => engine.signatures.save(input),
    'signatures:delete': (id) => engine.signatures.delete(id),
    'signatures:getPrefs': (id) => engine.signatures.getPrefs(id),
    'signatures:setPrefs': (id, prefs) => engine.signatures.setPrefs(id, prefs),
    'signatures:addImage': (data, mime) => engine.signatures.addImage(Buffer.from(data), mime),
    'signatures:importImage': async (url) => {
      const { data, mime } = await downloadImage(url)
      return engine.signatures.addImage(data, mime)
    },

    'app:getTheme': () => store.getSetting<ThemeMode>('theme', 'system'),
    'app:setTheme': (mode) => {
      store.setSetting('theme', mode)
      nativeTheme.themeSource = mode
    },
    'app:openExternal': async (url) => {
      // Solo link web/mailto: mai file:// o protocolli arbitrari.
      if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url)
    },
    'app:reconnect': () => engine.reconnectAll()
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      // Accetta richieste solo dalla finestra principale.
      if (event.sender !== getWindow()?.webContents) return { ok: false, error: 'Mittente IPC non autorizzato' }
      try {
        const data = await (fn as (...a: unknown[]) => unknown)(...args)
        return { ok: true, data }
      } catch (err) {
        if (err instanceof MailSetupError) return { ok: false, error: err.message, title: err.title, stage: err.stage }
        return { ok: false, error: humanizeError(err) }
      }
    })
  }
}

function humanizeError(err: unknown): string {
  const e = err as { message?: string; responseText?: string; code?: string; authenticationFailed?: boolean }
  if (e?.authenticationFailed || /auth|credentials|login/i.test(e?.responseText ?? '') || e?.code === 'EAUTH') {
    return 'Autenticazione fallita: controlla email e password per le app.'
  }
  switch (classifyError(err)) {
    case 'dns':
      return 'Server irraggiungibile: controlla la connessione a Internet.'
    case 'refused':
    case 'timeout':
      return 'Impossibile connettersi al server (porta chiusa o bloccata). Riprova tra poco.'
    case 'tls':
      return 'Connessione sicura non riuscita con il server.'
  }
  return e?.responseText || e?.message || String(err)
}
