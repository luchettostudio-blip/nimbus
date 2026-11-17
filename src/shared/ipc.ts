/**
 * Contratto IPC fra renderer e main process.
 *
 * Ogni canale `invoke` è dichiarato qui con argomenti e valore di ritorno:
 * main (handler), preload (whitelist) e renderer (client tipizzato) usano
 * tutti questa stessa mappa, così un errore di firma è un errore di compilazione.
 */
import type {
  Account,
  AppSettings,
  DraftMessage,
  Folder,
  InboxCategory,
  IndexStatus,
  MessageBody,
  MessageSummary,
  NewAccountInput,
  OutboxItem,
  OutboxKind,
  ProviderPreset,
  SignatureImage,
  SignaturePrefs,
  SignatureView,
  SnoozeItem,
  Subscription,
  SyncEvent,
  Unsubscription
} from '../core/models'
import type { UnsubscribePlan } from '../core/features/unsubscribe/listUnsubscribe'

export type ThemeMode = 'system' | 'dark' | 'light'

export interface IpcInvokeMap {
  'providers:list': { args: []; ret: ProviderPreset[] }

  'accounts:list': { args: []; ret: Account[] }
  'accounts:add': { args: [input: NewAccountInput]; ret: Account }
  'accounts:remove': { args: [accountId: string]; ret: void }

  'folders:list': { args: [accountId: string]; ret: Folder[] }
  'folders:refresh': { args: [accountId: string]; ret: void }
  'folders:inboxes': { args: []; ret: Folder[] }

  /** `category`: scheda della Posta in arrivo divisa (null = tutte). */
  'messages:list': { args: [accountId: string, folder: string, category?: InboxCategory | null]; ret: MessageSummary[] }
  'messages:sync': { args: [accountId: string, folder: string]; ret: void }
  'messages:loadOlder': { args: [accountId: string, folder: string]; ret: number }
  /** Ricerca full-text con operatori (da:, a:, oggetto:, ha:, prima:, dopo:, in:, non:letto…). */
  'messages:search': { args: [query: string]; ret: MessageSummary[] }
  /** IMAP SEARCH sul server; ritorna quante mail nuove sono state scaricate e indicizzate. */
  'search:server': { args: [query: string]; ret: number }
  'search:status': { args: []; ret: IndexStatus }
  'search:reindex': { args: []; ret: void }
  'messages:unified': { args: [category?: InboxCategory | null]; ret: MessageSummary[] }
  'inbox:counts': { args: [accountId: string | null]; ret: Record<InboxCategory, number> }
  'unsub:plan': { args: [accountId: string, address: string]; ret: UnsubscribePlan | null }
  'unsub:run': { args: [accountId: string, address: string, archiveAll: boolean]; ret: { method: UnsubscribePlan['method']; target: string } }
  'unsub:list': { args: []; ret: Unsubscription[] }
  'unsub:subscriptions': { args: [accountId: string | null]; ret: Subscription[] }
  'unsub:block': { args: [accountId: string, address: string]; ret: void }
  'unsub:unblock': { args: [accountId: string, address: string]; ret: void }
  /** Sposta il mittente in un'altra scheda; ritorna quante mail ha riclassificato. */
  'inbox:moveSender': { args: [accountId: string, address: string, category: InboxCategory]; ret: number }
  'threads:get': { args: [accountId: string, threadId: string]; ret: MessageSummary[] }
  'messages:syncUnified': { args: []; ret: void }
  'messages:body': { args: [accountId: string, folder: string, uid: number]; ret: MessageBody }
  'messages:setSeen': { args: [accountId: string, folder: string, uids: number[], seen: boolean]; ret: void }
  'messages:setFlagged': { args: [accountId: string, folder: string, uids: number[], flagged: boolean]; ret: void }
  'messages:archive': { args: [accountId: string, folder: string, uids: number[]]; ret: void }
  'messages:trash': { args: [accountId: string, folder: string, uids: number[]]; ret: void }
  'messages:send': { args: [draft: DraftMessage]; ret: void }

  'outbox:enqueue': { args: [draft: DraftMessage, mode: string, kind: OutboxKind, sendAt: number]; ret: OutboxItem }
  /** null = troppo tardi, il messaggio è già partito. */
  'outbox:cancel': { args: [id: string]; ret: OutboxItem | null }
  'outbox:update': { args: [id: string, patch: { draft?: DraftMessage; mode?: string; sendAt?: number }]; ret: OutboxItem }
  'outbox:sendNow': { args: [id: string]; ret: void }
  'outbox:sendAllMissed': { args: []; ret: void }
  'outbox:list': { args: []; ret: OutboxItem[] }

  'attachments:get': {
    args: [accountId: string, folder: string, uid: number, index: number]
    ret: { data: Uint8Array; mime: string; filename: string; size: number }
  }
  'attachments:open': { args: [accountId: string, folder: string, uid: number, index: number]; ret: void }
  /** false = l'utente ha annullato la finestra di salvataggio. */
  'attachments:save': { args: [accountId: string, folder: string, uid: number, index: number]; ret: boolean }

  'snooze:set': { args: [accountId: string, folder: string, uid: number, wakeAt: number]; ret: SnoozeItem }
  'snooze:cancel': { args: [id: string]; ret: void }
  'snooze:list': { args: []; ret: SnoozeItem[] }

  'settings:get': { args: []; ret: AppSettings }
  'settings:update': { args: [patch: Partial<AppSettings>]; ret: AppSettings }

  'signatures:list': { args: [accountId: string]; ret: SignatureView[] }
  'signatures:save': { args: [input: { id?: string; accountId: string; name: string; html: string }]; ret: SignatureView }
  'signatures:delete': { args: [id: string]; ret: void }
  'signatures:getPrefs': { args: [accountId: string]; ret: SignaturePrefs }
  'signatures:setPrefs': { args: [accountId: string, prefs: SignaturePrefs]; ret: void }
  /** Immagine caricata dall'utente: viene ridimensionata (max 300px) e compressa. */
  'signatures:addImage': { args: [data: Uint8Array, mime: string]; ret: SignatureImage }
  /** Immagine remota di una firma incollata: scaricata e incorporata come CID. */
  'signatures:importImage': { args: [url: string]; ret: SignatureImage }

  'app:getTheme': { args: []; ret: ThemeMode }
  'app:setTheme': { args: [mode: ThemeMode]; ret: void }
  'app:openExternal': { args: [url: string]; ret: void }
  'app:reconnect': { args: []; ret: void }
}

export type InvokeChannel = keyof IpcInvokeMap

export const INVOKE_CHANNELS: InvokeChannel[] = [
  'settings:get',
  'settings:update',
  'inbox:counts',
  'inbox:moveSender',
  'unsub:plan',
  'unsub:run',
  'unsub:list',
  'unsub:subscriptions',
  'unsub:block',
  'unsub:unblock',
  'threads:get',
  'search:server',
  'search:status',
  'search:reindex',
  'snooze:set',
  'snooze:cancel',
  'attachments:get',
  'attachments:open',
  'attachments:save',
  'snooze:list',
  'outbox:enqueue',
  'outbox:cancel',
  'outbox:update',
  'outbox:sendNow',
  'outbox:sendAllMissed',
  'outbox:list',
  'signatures:list',
  'signatures:save',
  'signatures:delete',
  'signatures:getPrefs',
  'signatures:setPrefs',
  'signatures:addImage',
  'signatures:importImage',
  'providers:list',
  'folders:inboxes',
  'messages:unified',
  'messages:syncUnified',
  'accounts:list',
  'accounts:add',
  'accounts:remove',
  'folders:list',
  'folders:refresh',
  'messages:list',
  'messages:sync',
  'messages:loadOlder',
  'messages:search',
  'messages:body',
  'messages:setSeen',
  'messages:setFlagged',
  'messages:archive',
  'messages:trash',
  'messages:send',
  'app:getTheme',
  'app:setTheme',
  'app:openExternal',
  'app:reconnect'
]

/** Gli errori viaggiano come valore (non come eccezione) per avere messaggi puliti nel renderer. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; title?: string; stage?: 'imap' | 'smtp' }

/** Eventi push main → renderer. */
export interface IpcEventMap {
  'sync:event': SyncEvent
  /** Click su una notifica: apri il messaggio indicato. */
  'app:openMessage': { accountId: string; folder: string; uid: number }
  /** Click su tray/notifica: apri una vista. */
  'app:navigate': { view: 'scheduled' | 'snoozed' }
}

export type EventChannel = keyof IpcEventMap
export const EVENT_CHANNELS: EventChannel[] = ['sync:event', 'app:openMessage', 'app:navigate']

/** API esposta su `window.api` dal preload. */
export interface PreloadApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: IpcInvokeMap[C]['args']): Promise<IpcResult<IpcInvokeMap[C]['ret']>>
  on<C extends EventChannel>(channel: C, listener: (payload: IpcEventMap[C]) => void): () => void
  platform: string
}
