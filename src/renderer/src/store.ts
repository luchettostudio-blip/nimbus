/**
 * Stato UI dell'app (zustand). Tutti i dati arrivano dal main process via IPC;
 * qui si tiene solo la selezione corrente e le copie per il rendering.
 *
 * Multi-account: `view` è o l'inbox unificata (tutti gli account) o una cartella
 * di un account. Poiché gli UID IMAP si ripetono fra account e cartelle, un
 * messaggio è identificato dalla chiave `account | cartella | uid` (vedi `msgKey`).
 */
import { create } from 'zustand'
import type {
  Account,
  AppSettings,
  AttachmentInfo,
  DraftMessage,
  Folder,
  InboxCategory,
  IndexStatus,
  MessageBody,
  MessageSummary,
  OutboxItem,
  SignaturePrefs,
  SnoozeItem,
  SignatureView,
  Subscription,
  SyncEvent,
  Unsubscription
} from '@core/models'
import type { UnsubscribePlan } from '@core/features/unsubscribe/listUnsubscribe'
import { call } from './lib/api'
import { formatWhen } from './lib/schedule'

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

export interface ComposeState {
  mode: ComposeMode
  /** Account mittente. */
  accountId: string
  to: string
  cc: string
  subject: string
  /** Solo il testo scritto dall'utente: firma e citazione sono separate. */
  body: string
  /** Testo citato (risposte/inoltri): va SOTTO la firma. */
  quoted: { header: string; text: string } | null
  /** Firma scelta (null = nessuna). */
  signatureId?: string | null
  inReplyTo?: string
  references?: string[]
  /** Se si sta modificando un invio programmato: il suo id e l'orario. */
  outboxId?: string
  scheduledAt?: number
}

/** Invio in attesa nella finestra di "Annulla invio". */
export interface PendingSend {
  id: string
  sendAt: number
  /** Stato del compositore, per riaprirlo intatto se si annulla. */
  compose: ComposeState
}

/** Anteprima allegati aperta. */
export interface ViewerState {
  accountId: string
  folder: string
  uid: number
  attachments: AttachmentInfo[]
  index: number
}

export interface ThreadState {
  /** Chiave del messaggio selezionato nella lista che ha aperto la conversazione. */
  key: string
  accountId: string
  threadId: string
  messages: MessageSummary[]
  bodies: Record<string, MessageBody>
}

export type SettingsSection = 'general' | 'signatures' | 'unsubscribes'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

export type View =
  | { kind: 'unified' }
  | { kind: 'folder'; accountId: string; path: string }
  | { kind: 'scheduled' }
  | { kind: 'snoozed' }
  /** "Gestisci iscrizioni"; `back` è la vista a cui tornare. */
  | { kind: 'subscriptions'; back: View | null }

type AccountStatus = Extract<SyncEvent, { type: 'status' }>['state']

export const msgKey = (m: Pick<MessageSummary, 'accountId' | 'folder' | 'uid'>) => `${m.accountId}|${m.folder}|${m.uid}`

interface State {
  ready: boolean
  accounts: Account[]
  /** Account "corrente": le sue cartelle sono in sidebar ed è il mittente predefinito. */
  accountId: string | null
  folders: Folder[]
  /** Posta in arrivo di ogni account (contatori dell'inbox unificata). */
  inboxes: Folder[]
  view: View | null
  messages: MessageSummary[]
  selectedKey: string | null
  body: MessageBody | null
  bodyLoading: boolean
  bodyError: string | null
  status: Record<string, { state: AccountStatus; error?: string }>
  loadingOlder: boolean
  noMoreOlder: boolean

  /** Barra di ricerca aperta nella lista. */
  searchOpen: boolean
  searchQuery: string
  searchResults: MessageSummary[] | null
  serverSearching: boolean
  indexStatus: IndexStatus | null

  compose: ComposeState | null
  paletteOpen: boolean
  settings: AppSettings | null
  settingsOpen: boolean
  settingsSection: SettingsSection
  signatures: Record<string, SignatureView[]>
  signaturePrefs: Record<string, SignaturePrefs>
  pendingSends: PendingSend[]
  outbox: OutboxItem[]
  snoozes: SnoozeItem[]
  snoozeMenuOpen: boolean
  viewer: ViewerState | null
  /** Conversazione aperta (vista chat). */
  thread: ThreadState | null
  /** Scheda della Posta in arrivo divisa. */
  inboxTab: InboxCategory
  tabCounts: Record<InboxCategory, number>
  /** Menu contestuale (clic destro) su una riga della lista. */
  contextMenu: { x: number; y: number; key: string } | null
  unsubDialog: { accountId: string; address: string; name: string | null; plan: UnsubscribePlan } | null
  unsubscriptions: Unsubscription[]
  subscriptions: Subscription[]
  /** Mittenti che scrivono ancora dopo la disiscrizione (proposta di blocco). */
  blockSuggestions: { id: string; accountId: string; address: string; name: string | null }[]
  showOnboarding: boolean
  toasts: Toast[]

  init(): Promise<void>
  handleSyncEvent(e: SyncEvent): void
  selectAccount(id: string): Promise<void>
  selectUnified(): Promise<void>
  selectFolder(path: string): Promise<void>
  /** Scorciatoia Ctrl+0…9: 0 = inbox unificata, n = account n-esimo. */
  quickSwitch(index: number): void
  reloadMessages(): Promise<void>
  reloadInboxes(): Promise<void>
  selectMessage(key: string | null): Promise<void>
  openMessageRef(ref: { accountId: string; folder: string; uid: number }): Promise<void>
  moveSelection(delta: number): void
  loadOlder(): Promise<void>
  /** Aggiorna la query: i risultati arrivano dopo 150 ms di pausa nella digitazione. */
  search(q: string): void
  openSearch(initial?: string): void
  closeSearch(): void
  /** IMAP SEARCH sul server per ciò che non è nell'indice locale. */
  searchServer(): Promise<void>

  toggleSeen(): Promise<void>
  toggleFlagged(): Promise<void>
  archive(): Promise<void>
  trash(): Promise<void>

  openCompose(mode: ComposeMode, target?: { msg: MessageSummary; body: MessageBody | null; text?: string }): void
  updateCompose(patch: Partial<ComposeState>): void
  closeCompose(): void
  /** Invia (con finestra "Annulla invio") oppure programma se `scheduleAt` è indicato. */
  send(scheduleAt?: number): Promise<boolean>
  /** Invia subito un programmato in modifica. */
  sendScheduledNow(): Promise<boolean>
  undoSend(id: string): Promise<void>
  loadOutbox(): Promise<void>
  selectScheduled(): void
  selectSnoozed(): void
  openViewer(v: ViewerState): void
  /** Chiede conferma per la disiscrizione dal mittente. */
  askUnsubscribe(accountId: string, address: string, name: string | null): Promise<void>
  closeUnsubscribe(): void
  confirmUnsubscribe(archiveAll: boolean): Promise<void>
  loadUnsubscriptions(): Promise<void>
  loadSubscriptions(): Promise<void>
  openSubscriptions(): void
  closeSubscriptions(): void
  dismissBlockSuggestion(id: string): void
  setInboxTab(tab: InboxCategory): void
  /** Sposta il mittente della mail in un'altra scheda (Nimbus lo ricorda). */
  moveToTab(key: string, tab: InboxCategory): Promise<void>
  openContextMenu(x: number, y: number, key: string): void
  closeContextMenu(): void
  /** Risposta rapida in fondo alla conversazione; `expand` apre il compositore completo. */
  quickReply(text: string, expand?: boolean): Promise<boolean>
  closeViewer(): void
  moveViewer(delta: number): void
  loadSnoozes(): Promise<void>
  setSnoozeMenu(open: boolean): void
  /** Rimanda la mail selezionata fino a `wakeAt`. */
  snooze(wakeAt: number): Promise<void>
  cancelSnooze(id: string): Promise<void>
  editOutbox(item: OutboxItem): void

  setPalette(open: boolean): void
  openSettings(section?: SettingsSection): void
  closeSettings(): void
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  loadSignatures(accountId: string): Promise<void>
  setOnboarding(open: boolean): void
  accountAdded(a: Account): Promise<void>
  toast(text: string, kind?: Toast['kind']): void
}

let toastSeq = 1
let searchTimer: ReturnType<typeof setTimeout> | null = null
let markSeenTimer: ReturnType<typeof setTimeout> | null = null

/** Messaggi attualmente visibili nella lista (risultati di ricerca o vista corrente). */
export function visibleMessages(s: Pick<State, 'messages' | 'searchResults'>): MessageSummary[] {
  return s.searchResults ?? s.messages
}

export function currentMessage(s: Pick<State, 'messages' | 'searchResults' | 'selectedKey'>): MessageSummary | undefined {
  if (!s.selectedKey) return undefined
  return visibleMessages(s).find((m) => msgKey(m) === s.selectedKey)
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  accounts: [],
  accountId: null,
  folders: [],
  inboxes: [],
  view: null,
  messages: [],
  selectedKey: null,
  body: null,
  bodyLoading: false,
  bodyError: null,
  status: {},
  loadingOlder: false,
  noMoreOlder: false,
  searchOpen: false,
  searchQuery: '',
  searchResults: null,
  serverSearching: false,
  indexStatus: null,
  compose: null,
  paletteOpen: false,
  settings: null,
  settingsOpen: false,
  settingsSection: 'general',
  signatures: {},
  signaturePrefs: {},
  pendingSends: [],
  outbox: [],
  snoozes: [],
  snoozeMenuOpen: false,
  viewer: null,
  thread: null,
  inboxTab: 'people',
  tabCounts: { people: 0, newsletter: 0, notifications: 0 },
  contextMenu: null,
  unsubDialog: null,
  unsubscriptions: [],
  subscriptions: [],
  blockSuggestions: [],
  showOnboarding: false,
  toasts: [],

  async init() {
    const [accounts, settings] = await Promise.all([call('accounts:list'), call('settings:get')])
    set({ accounts, settings, ready: true, showOnboarding: accounts.length === 0 })
    await Promise.all(accounts.map((a) => get().loadSignatures(a.id)))
    if (accounts.length === 0) return
    await get().reloadInboxes()
    await get().selectAccount(accounts[0].id)
    // Con più caselle si parte dall'inbox unificata.
    if (accounts.length > 1) await get().selectUnified()
    void get().loadSnoozes()
    // Invii programmati non partiti a PC spento: si chiede subito cosa fare.
    await get().loadOutbox()
    if (get().outbox.some((o) => o.status === 'missed')) get().selectScheduled()
  },

  handleSyncEvent(e) {
    const s = get()
    if (e.type === 'status') {
      set({ status: { ...s.status, [e.accountId]: { state: e.state, error: e.error } } })
      return
    }
    if (e.type.startsWith('outbox')) {
      handleOutboxEvent(e, get, set)
      return
    }
    if (e.type === 'index-progress') {
      set({ indexStatus: { running: e.running, done: e.done, total: e.total } })
      return
    }
    if (e.type === 'unsubscriptions') {
      void get().loadUnsubscriptions()
      return
    }
    if (e.type === 'unsub-still-sending') {
      set({ blockSuggestions: [...get().blockSuggestions.filter((b) => b.id !== e.id), { id: e.id, accountId: e.accountId, address: e.address, name: e.name }] })
      return
    }
    if (e.type === 'snooze' || e.type === 'snooze-woke') {
      void get().loadSnoozes()
      return
    }
    if (e.type === 'folders') {
      void get().reloadInboxes()
      if (e.accountId !== s.accountId) return
      void call('folders:list', e.accountId).then((folders) => {
        set({ folders })
        // Prima sincronizzazione di un account appena aggiunto: apri la sua Inbox.
        if (!get().view) {
          const inbox = folders.find((f) => f.role === 'inbox') ?? folders[0]
          if (inbox) void get().selectFolder(inbox.path)
        }
      })
    } else if (e.type === 'messages') {
      const v = s.view
      if (!v) return
      // Con thread o inbox divisa, una mail in un'altra cartella (es. la mia risposta in
      // Inviata) cambia conversazioni e schede di quelle mostrate: si ricarica.
      const threads = !!s.settings?.threads || !!s.settings?.splitInbox
      if (v.kind === 'unified') {
        const isInbox = s.inboxes.some((f) => f.accountId === e.accountId && f.path === e.folder)
        if (isInbox || threads) void get().reloadMessages()
      } else if (v.kind === 'folder' && v.accountId === e.accountId && (v.path === e.folder || threads)) {
        void get().reloadMessages()
      }
    }
  },

  async selectAccount(id) {
    set({ accountId: id, folders: [] })
    const folders = await call('folders:list', id)
    if (get().accountId !== id) return
    set({ folders })
    const inbox = folders.find((f) => f.role === 'inbox') ?? folders[0]
    if (inbox) await get().selectFolder(inbox.path)
    else set({ view: null, messages: [], selectedKey: null, body: null })
  },

  async selectUnified() {
    set({ view: { kind: 'unified' }, selectedKey: null, body: null, searchResults: null, searchQuery: '', searchOpen: false, noMoreOlder: true })
    await get().reloadMessages()
    call('messages:syncUnified').catch(() => {})
  },

  async selectFolder(path) {
    const { accountId } = get()
    if (!accountId) return
    set({ view: { kind: 'folder', accountId, path }, selectedKey: null, body: null, searchResults: null, searchQuery: '', searchOpen: false, noMoreOlder: false })
    await get().reloadMessages()
    // Aggiorna dal server in background; l'evento 'messages' ricaricherà la lista.
    call('messages:sync', accountId, path).catch((err) => get().toast(String(err.message ?? err), 'error'))
  },

  quickSwitch(index) {
    const { accounts } = get()
    if (index === 0) {
      if (accounts.length > 1) void get().selectUnified()
      return
    }
    const a = accounts[index - 1]
    if (a) void get().selectAccount(a.id)
  },

  async reloadMessages() {
    const view = get().view
    if (!view || view.kind === 'scheduled' || view.kind === 'snoozed' || view.kind === 'subscriptions') return
    const tab = isSplitInbox(get()) ? get().inboxTab : null
    const messages = view.kind === 'unified' ? await call('messages:unified', tab) : await call('messages:list', view.accountId, view.path, tab)
    if (get().view !== view || (isSplitInbox(get()) ? get().inboxTab : null) !== tab) return
    set({ messages })
    if (tab) void call('inbox:counts', view.kind === 'unified' ? null : view.accountId).then((tabCounts) => set({ tabCounts }))
    const sel = get().selectedKey
    if (sel !== null && !visibleMessages(get()).some((m) => msgKey(m) === sel)) set({ selectedKey: null, body: null })
  },

  async reloadInboxes() {
    set({ inboxes: await call('folders:inboxes') })
  },

  async selectMessage(key) {
    if (markSeenTimer) clearTimeout(markSeenTimer)
    set({ selectedKey: key, body: null, bodyError: null, thread: null })
    if (key === null) return
    const msg = currentMessage(get())
    if (!msg) return
    if (get().settings?.threads && (msg.threadCount ?? 1) > 1 && msg.threadId) {
      void loadThread(get, set, key, msg)
    }
    set({ bodyLoading: true })
    try {
      const body = await call('messages:body', msg.accountId, msg.folder, msg.uid)
      if (get().selectedKey === key) set({ body })
    } catch (err) {
      if (get().selectedKey === key) set({ bodyError: (err as Error).message })
    } finally {
      if (get().selectedKey === key) set({ bodyLoading: false })
    }
    // Segna come letto dopo un attimo (evita di marcare i messaggi "sfogliati" con j/k).
    if (!msg.seen) {
      markSeenTimer = setTimeout(() => {
        if (get().selectedKey !== key) return
        const mark = (list: MessageSummary[]) => list.map((m) => (msgKey(m) === key ? { ...m, seen: true } : m))
        set({ messages: mark(get().messages), searchResults: get().searchResults && mark(get().searchResults!) })
        call('messages:setSeen', msg.accountId, msg.folder, [msg.uid], true).catch(() => {})
      }, 700)
    }
  },

  async openMessageRef(ref) {
    if (get().accountId !== ref.accountId) await get().selectAccount(ref.accountId)
    const v = get().view
    if (!(v?.kind === 'folder' && v.path === ref.folder)) await get().selectFolder(ref.folder)
    await get().selectMessage(msgKey(ref))
  },

  moveSelection(delta) {
    const list = visibleMessages(get())
    if (list.length === 0) return
    const idx = list.findIndex((m) => msgKey(m) === get().selectedKey)
    const next = idx === -1 ? 0 : Math.max(0, Math.min(list.length - 1, idx + delta))
    const key = msgKey(list[next])
    if (key !== get().selectedKey) void get().selectMessage(key)
  },

  async loadOlder() {
    const { view, loadingOlder, noMoreOlder, searchResults } = get()
    if (view?.kind !== 'folder' || loadingOlder || noMoreOlder || searchResults) return
    set({ loadingOlder: true })
    try {
      const n = await call('messages:loadOlder', view.accountId, view.path)
      if (n === 0) set({ noMoreOlder: true })
    } catch {
      /* offline: riproverà allo scroll successivo */
    } finally {
      set({ loadingOlder: false })
    }
  },

  search(q) {
    set({ searchQuery: q, searchOpen: true })
    if (searchTimer) clearTimeout(searchTimer)
    if (!q.trim()) {
      set({ searchResults: null })
      return
    }
    // Debounce: si cerca quando l'utente fa una pausa di 150 ms.
    searchTimer = setTimeout(async () => {
      const results = await call('messages:search', q.trim()).catch(() => [] as MessageSummary[])
      if (get().searchQuery !== q) return
      const sel = get().selectedKey
      const keep = sel !== null && results.some((m) => msgKey(m) === sel)
      set({ searchResults: results, ...(keep ? {} : { selectedKey: null, body: null }) })
    }, 150)
  },

  openSearch(initial) {
    set({ searchOpen: true })
    if (initial !== undefined) get().search(initial)
  },

  closeSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    const hadResults = get().searchResults !== null
    set({ searchOpen: false, searchQuery: '', searchResults: null, ...(hadResults ? { selectedKey: null, body: null } : {}) })
  },

  async searchServer() {
    const q = get().searchQuery.trim()
    if (!q) return
    set({ serverSearching: true })
    try {
      const added = await call('search:server', q)
      const results = await call('messages:search', q)
      if (get().searchQuery.trim() === q) set({ searchResults: results })
      get().toast(added ? `Trovate ${added} mail sul server` : 'Nessun altro risultato sul server')
    } catch (e) {
      get().toast((e as Error).message, 'error')
    } finally {
      set({ serverSearching: false })
    }
  },

  async toggleSeen() {
    const msg = currentMessage(get())
    if (!msg) return
    await call('messages:setSeen', msg.accountId, msg.folder, [msg.uid], !msg.seen).catch((e) => get().toast(e.message, 'error'))
  },

  async toggleFlagged() {
    const msg = currentMessage(get())
    if (!msg) return
    await call('messages:setFlagged', msg.accountId, msg.folder, [msg.uid], !msg.flagged).catch((e) => get().toast(e.message, 'error'))
  },

  async archive() {
    const msg = currentMessage(get())
    if (!msg) return
    const uids = threadUidsInFolder(get(), msg)
    advanceAfterRemoval(get, set, msgKey(msg))
    try {
      await call('messages:archive', msg.accountId, msg.folder, uids)
      get().toast('Archiviato')
    } catch (e) {
      get().toast((e as Error).message, 'error')
    }
  },

  async trash() {
    const msg = currentMessage(get())
    if (!msg) return
    const uids = threadUidsInFolder(get(), msg)
    advanceAfterRemoval(get, set, msgKey(msg))
    try {
      await call('messages:trash', msg.accountId, msg.folder, uids)
      get().toast('Eliminato')
    } catch (e) {
      get().toast((e as Error).message, 'error')
    }
  },

  openCompose(mode, target) {
    const s = get()
    const defaultAccount = (s.view?.kind === 'folder' ? s.view.accountId : s.accountId) ?? s.accounts[0]?.id
    if (!defaultAccount) return
    if (mode === 'new') {
      const signatureId = defaultSignature(get(), defaultAccount, mode)
      set({ compose: { mode, accountId: defaultAccount, to: '', cc: '', subject: '', body: '', quoted: null, signatureId } })
      return
    }
    const msg = target?.msg ?? currentMessage(s)
    const body = target ? target.body : s.body
    if (!msg) return
    // Si risponde sempre dall'account che ha ricevuto il messaggio.
    const accountId = msg.accountId
    const me = s.accounts.find((a) => a.id === accountId)?.email.toLowerCase()
    const originalText = (body?.text ?? msg.snippet).replace(/\s+$/, '')
    const header = `Il giorno ${new Date(msg.date).toLocaleString('it-IT')}, ${msg.from?.name || msg.from?.address} ha scritto:`
    const signatureId = defaultSignature(s, accountId, mode)
    // RFC 5322: References = References del messaggio (o, se mancano, il suo In-Reply-To) + il suo Message-ID.
    const parentRefs = body?.references?.length
      ? body.references
      : msg.references?.length
        ? msg.references
        : [body?.inReplyTo ?? msg.inReplyTo].filter((x): x is string => !!x)
    const refs = [...new Set([...parentRefs, ...(msg.messageId ? [msg.messageId] : [])])]

    if (mode === 'forward') {
      const fwdHeader = [
        '---------- Messaggio inoltrato ----------',
        `Da: ${msg.from ? `${msg.from.name} <${msg.from.address}>` : ''}`,
        `Data: ${new Date(msg.date).toLocaleString('it-IT')}`,
        `Oggetto: ${msg.subject}`,
        `A: ${msg.to.map((a) => a.address).join(', ')}`
      ].join('\n')
      set({
        compose: {
          mode,
          accountId,
          to: '',
          cc: '',
          subject: prefixSubject('Fwd: ', msg.subject),
          body: '',
          quoted: { header: fwdHeader, text: originalText },
          signatureId
        }
      })
      return
    }

    const replyTarget = body?.replyTo.length ? body.replyTo : msg.from ? [msg.from] : []
    const to = replyTarget.map((a) => a.address)
    let cc: string[] = []
    if (mode === 'replyAll') {
      const all = [...msg.to, ...(body?.cc ?? [])].map((a) => a.address)
      cc = all.filter((addr) => addr && addr.toLowerCase() !== me && !to.includes(addr))
    }
    set({
      compose: {
        mode,
        accountId,
        to: to.join(', '),
        cc: cc.join(', '),
        subject: prefixSubject('Re: ', msg.subject),
        body: target?.text ?? '',
        quoted: { header, text: originalText },
        signatureId,
        inReplyTo: msg.messageId ?? undefined,
        references: refs.length ? refs : undefined
      }
    })
  },

  updateCompose(patch) {
    const c = get().compose
    if (!c) return
    const next = { ...c, ...patch }
    // Cambiando mittente si passa alla firma predefinita del nuovo account.
    if (patch.accountId && patch.accountId !== c.accountId && !('signatureId' in patch)) {
      next.signatureId = defaultSignature(get(), patch.accountId, c.mode)
    }
    set({ compose: next })
  },

  closeCompose() {
    set({ compose: null })
  },

  async send(scheduleAt) {
    const { compose, settings } = get()
    if (!compose) return false
    const draft = composeToDraft(compose)
    if (draft.to.length === 0) {
      get().toast('Aggiungi almeno un destinatario', 'error')
      return false
    }
    try {
      // Modifica di un programmato: aggiorna contenuto (e orario, se scelto).
      if (compose.outboxId) {
        await call('outbox:update', compose.outboxId, { draft, mode: compose.mode, sendAt: scheduleAt ?? compose.scheduledAt })
        set({ compose: null })
        get().toast(`Programmato per ${formatWhen(scheduleAt ?? compose.scheduledAt!)}`)
        return true
      }
      if (scheduleAt) {
        if (scheduleAt < Date.now() + 30_000) {
          get().toast('Scegli un orario nel futuro', 'error')
          return false
        }
        await call('outbox:enqueue', draft, compose.mode, 'scheduled', scheduleAt)
        set({ compose: null })
        get().toast(`Programmato per ${formatWhen(scheduleAt)}`)
        return true
      }
      // Invio normale: parte dopo N secondi, finché si può annullare.
      const seconds = settings?.undoSendSeconds ?? 10
      const item = await call('outbox:enqueue', draft, compose.mode, 'undo', Date.now() + seconds * 1000)
      set({ compose: null, pendingSends: [...get().pendingSends, { id: item.id, sendAt: item.sendAt, compose }] })
      return true
    } catch (e) {
      get().toast((e as Error).message, 'error')
      return false
    }
  },

  async sendScheduledNow() {
    const { compose } = get()
    if (!compose?.outboxId) return false
    const draft = composeToDraft(compose)
    try {
      await call('outbox:update', compose.outboxId, { draft, mode: compose.mode })
      set({ compose: null })
      await call('outbox:sendNow', compose.outboxId)
      return true
    } catch (e) {
      get().toast((e as Error).message, 'error')
      return false
    }
  },

  async undoSend(id) {
    const pending = get().pendingSends.find((p) => p.id === id)
    set({ pendingSends: get().pendingSends.filter((p) => p.id !== id) })
    const item = await call('outbox:cancel', id)
    if (!item) {
      get().toast('Troppo tardi: il messaggio è già partito', 'error')
      return
    }
    // Riapre il compositore esattamente com'era.
    if (pending) set({ compose: pending.compose })
  },

  async loadOutbox() {
    set({ outbox: await call('outbox:list') })
  },

  selectScheduled() {
    set({ view: { kind: 'scheduled' }, selectedKey: null, body: null, searchResults: null, searchQuery: '' })
    void get().loadOutbox()
  },

  async askUnsubscribe(accountId, address, name) {
    set({ contextMenu: null })
    const plan = await call('unsub:plan', accountId, address)
    if (!plan) {
      get().toast('Questo mittente non indica come disiscriversi', 'error')
      return
    }
    set({ unsubDialog: { accountId, address, name, plan } })
  },

  closeUnsubscribe() {
    set({ unsubDialog: null })
  },

  async confirmUnsubscribe(archiveAll) {
    const d = get().unsubDialog
    if (!d) return
    try {
      const r = await call('unsub:run', d.accountId, d.address, archiveAll)
      set({ unsubDialog: null })
      const who = d.name || d.address
      get().toast(
        r.method === 'browser' ? `Pagina di disiscrizione di ${who} aperta nel browser` : r.method === 'mailto' ? `Mail di disiscrizione inviata a ${who}` : `Disiscritto da ${who}`
      )
      await Promise.all([get().reloadMessages(), get().loadSubscriptions(), get().loadUnsubscriptions()])
    } catch (e) {
      get().toast((e as Error).message, 'error')
    }
  },

  async loadUnsubscriptions() {
    set({ unsubscriptions: await call('unsub:list') })
  },

  async loadSubscriptions() {
    const v = get().view
    const back = v?.kind === 'subscriptions' ? v.back : v
    const accountId = back?.kind === 'folder' ? back.accountId : null
    set({ subscriptions: await call('unsub:subscriptions', accountId) })
  },

  openSubscriptions() {
    set({ view: { kind: 'subscriptions', back: get().view }, selectedKey: null, body: null, thread: null })
    void get().loadSubscriptions()
  },

  closeSubscriptions() {
    const v = get().view
    if (v?.kind !== 'subscriptions') return
    set({ view: v.back })
    void get().reloadMessages()
  },

  dismissBlockSuggestion(id) {
    set({ blockSuggestions: get().blockSuggestions.filter((b) => b.id !== id) })
  },

  setInboxTab(tab) {
    if (get().inboxTab === tab) return
    set({ inboxTab: tab, selectedKey: null, body: null, thread: null })
    void get().reloadMessages()
  },

  async moveToTab(key, tab) {
    const msg = visibleMessages(get()).find((m) => msgKey(m) === key)
    if (!msg?.from?.address) return
    set({ contextMenu: null })
    const n = await call('inbox:moveSender', msg.accountId, msg.from.address, tab)
    const label = { people: 'Persone', newsletter: 'Newsletter', notifications: 'Notifiche' }[tab]
    get().toast(`Da ora le mail di ${msg.from.name || msg.from.address} vanno in ${label}${n > 1 ? ` (${n} spostate)` : ''}`)
    await get().reloadMessages()
  },

  openContextMenu(x, y, key) {
    set({ contextMenu: { x, y, key } })
  },

  closeContextMenu() {
    set({ contextMenu: null })
  },

  async quickReply(text, expand) {
    const th = get().thread
    if (!th || (!text.trim() && !expand)) return false
    const me = get().accounts.find((a) => a.id === th.accountId)?.email.toLowerCase()
    // Si risponde all'ultimo messaggio degli altri (o all'ultimo in assoluto).
    const target = [...th.messages].reverse().find((m) => m.from?.address.toLowerCase() !== me) ?? th.messages[th.messages.length - 1]
    get().openCompose('replyAll', { msg: target, body: th.bodies[msgKey(target)] ?? null, text })
    // References con l'intera catena della conversazione fino al messaggio a cui si risponde.
    const chain = th.messages
      .filter((m) => m.date <= target.date)
      .flatMap((m) => [...(m.references ?? []), ...(m.messageId ? [m.messageId] : [])])
    const c = get().compose
    if (c) set({ compose: { ...c, references: [...new Set([...chain, ...(c.references ?? [])])] } })
    if (expand) return true
    return get().send()
  },

  openViewer(v) {
    set({ viewer: v })
  },

  closeViewer() {
    set({ viewer: null })
  },

  moveViewer(delta) {
    const v = get().viewer
    if (!v || v.attachments.length < 2) return
    const index = (v.index + delta + v.attachments.length) % v.attachments.length
    set({ viewer: { ...v, index } })
  },

  selectSnoozed() {
    set({ view: { kind: 'snoozed' }, selectedKey: null, body: null, searchResults: null, searchQuery: '' })
    void get().loadSnoozes()
  },

  async loadSnoozes() {
    set({ snoozes: await call('snooze:list') })
  },

  setSnoozeMenu(open) {
    set({ snoozeMenuOpen: open && !!currentMessage(get()) })
  },

  async snooze(wakeAt) {
    const msg = currentMessage(get())
    set({ snoozeMenuOpen: false })
    if (!msg) return
    advanceAfterRemoval(get, set, msgKey(msg))
    try {
      await call('snooze:set', msg.accountId, msg.folder, msg.uid, wakeAt)
      get().toast(`Rimandata a ${formatWhen(wakeAt)}`)
    } catch (e) {
      get().toast((e as Error).message, 'error')
      void get().reloadMessages()
    }
  },

  async cancelSnooze(id) {
    set({ snoozes: get().snoozes.filter((s) => s.id !== id) })
    try {
      await call('snooze:cancel', id)
      get().toast('Tornata in Posta in arrivo')
    } catch (e) {
      get().toast((e as Error).message, 'error')
      void get().loadSnoozes()
    }
  },

  editOutbox(item) {
    const d = item.draft
    set({
      compose: {
        mode: (item.mode as ComposeMode) ?? 'new',
        accountId: d.accountId,
        to: d.to.join(', '),
        cc: d.cc.join(', '),
        subject: d.subject,
        body: d.body,
        quoted: d.quoted ?? null,
        signatureId: d.signatureId ?? null,
        inReplyTo: d.inReplyTo,
        references: d.references,
        outboxId: item.id,
        scheduledAt: item.sendAt
      }
    })
  },

  setPalette(open) {
    set({ paletteOpen: open })
  },

  openSettings(section) {
    set({ settingsOpen: true, settingsSection: section ?? get().settingsSection })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  async updateSettings(patch) {
    set({ settings: { ...get().settings!, ...patch } })
    set({ settings: await call('settings:update', patch) })
    if ('threads' in patch || 'splitInbox' in patch) {
      set({ selectedKey: null, body: null, thread: null })
      await get().reloadMessages()
    }
  },

  async loadSignatures(accountId) {
    const [list, prefs] = await Promise.all([call('signatures:list', accountId), call('signatures:getPrefs', accountId)])
    set({ signatures: { ...get().signatures, [accountId]: list }, signaturePrefs: { ...get().signaturePrefs, [accountId]: prefs } })
  },

  setOnboarding(open) {
    set({ showOnboarding: open })
  },

  async accountAdded(a) {
    set({ accounts: [...get().accounts, a], showOnboarding: false, view: null, messages: [] })
    void get().loadSignatures(a.id)
    // Le cartelle arrivano col primo sync: l'evento 'folders' aprirà la sua Inbox.
    await get().selectAccount(a.id)
  },

  toast(text, kind = 'info') {
    const id = toastSeq++
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 5000 : 2200)
  }
}))

/** Dopo archivia/elimina seleziona il messaggio successivo, come Superhuman. */
function advanceAfterRemoval(get: () => State, set: (p: Partial<State>) => void, key: string): void {
  const list = visibleMessages(get())
  const idx = list.findIndex((m) => msgKey(m) === key)
  const remaining = list.filter((m) => msgKey(m) !== key)
  const s = get()
  set(s.searchResults ? { searchResults: remaining } : { messages: remaining })
  const next = remaining[Math.min(idx, remaining.length - 1)]
  void get().selectMessage(next ? msgKey(next) : null)
}

/** Non aggiunge "Re:" se l'oggetto è già una risposta (Re:, R:, RIF:, AW:…) né "Fwd:" a un inoltro (Fwd:, I:, TR:…). */
function prefixSubject(prefix: string, subject: string): string {
  const already = prefix.startsWith('Re') ? /^\s*(re|r|ri|rif|aw|sv|antw)(\[\d+\])?\s*:/i : /^\s*(fwd?|fw|i|inoltro|tr|wg)(\[\d+\])?\s*:/i
  return already.test(subject) ? subject : prefix + subject
}

/** true se la vista è una Posta in arrivo (singola o unificata) con la divisione attiva. */
export function isSplitInbox(s: Pick<State, 'view' | 'folders' | 'settings'>): boolean {
  if (!s.settings?.splitInbox || !s.view) return false
  if (s.view.kind === 'unified') return true
  if (s.view.kind !== 'folder') return false
  const path = s.view.path
  return s.folders.find((f) => f.path === path)?.role === 'inbox'
}

/** UID dei messaggi della conversazione aperta che stanno nella stessa cartella. */
function threadUidsInFolder(s: State, msg: MessageSummary): number[] {
  const th = s.thread
  if (!th || th.key !== msgKey(msg)) return [msg.uid]
  const uids = th.messages.filter((m) => m.folder === msg.folder && m.accountId === msg.accountId).map((m) => m.uid)
  return uids.length ? uids : [msg.uid]
}

/** Carica conversazione + corpi; dopo un attimo segna come lette le non lette. */
async function loadThread(get: () => State, set: (p: Partial<State>) => void, key: string, msg: MessageSummary): Promise<void> {
  const messages = await call('threads:get', msg.accountId, msg.threadId!)
  if (get().selectedKey !== key) return
  set({ thread: { key, accountId: msg.accountId, threadId: msg.threadId!, messages, bodies: {} } })
  // Corpi in parallelo (cache locale nella maggior parte dei casi).
  await Promise.all(
    messages.map(async (m) => {
      try {
        const b = await call('messages:body', m.accountId, m.folder, m.uid)
        const th = get().thread
        if (th?.key === key) set({ thread: { ...th, bodies: { ...th.bodies, [msgKey(m)]: b } } })
      } catch {
        /* il messaggio resta con l'anteprima */
      }
    })
  )
  setTimeout(() => {
    const th = get().thread
    if (th?.key !== key) return
    const unread = th.messages.filter((m) => !m.seen)
    const byFolder = new Map<string, number[]>()
    for (const m of unread) byFolder.set(m.folder, [...(byFolder.get(m.folder) ?? []), m.uid])
    for (const [folder, uids] of byFolder) void call('messages:setSeen', th.accountId, folder, uids, true).catch(() => {})
  }, 900)
}

function composeToDraft(c: ComposeState): DraftMessage {
  const split = (v: string) =>
    v
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean)
  return {
    accountId: c.accountId,
    to: split(c.to),
    cc: split(c.cc),
    bcc: [],
    subject: c.subject,
    body: c.body,
    quoted: c.quoted,
    signatureId: c.signatureId ?? null,
    inReplyTo: c.inReplyTo,
    references: c.references
  }
}

type Getter = () => State
type Setter = (p: Partial<State>) => void

/** Eventi della outbox: toast di conferma/errore e aggiornamento della lista programmati. */
function handleOutboxEvent(e: SyncEvent, get: Getter, set: Setter): void {
  if (e.type === 'outbox') {
    void get().loadOutbox()
  } else if (e.type === 'outbox-sent') {
    const wasPending = get().pendingSends.some((p) => p.id === e.id)
    set({ pendingSends: get().pendingSends.filter((p) => p.id !== e.id) })
    get().toast(wasPending || e.kind === 'undo' ? 'Messaggio inviato' : `Inviato: ${e.subject || '(nessun oggetto)'}`)
  } else if (e.type === 'outbox-failed') {
    const pending = get().pendingSends.find((p) => p.id === e.id)
    set({ pendingSends: get().pendingSends.filter((p) => p.id !== e.id) })
    get().toast(`Invio non riuscito: ${e.error}`, 'error')
    // "Annulla invio" fallito: riapre il compositore e ritira il messaggio dalla coda.
    if (pending && e.kind === 'undo') {
      void call('outbox:cancel', e.id)
      if (!get().compose) set({ compose: pending.compose })
    }
  } else if (e.type === 'outbox-missed') {
    get().selectScheduled()
  }
}

/** Firma predefinita dell'account per il tipo di messaggio (nuovo / risposta-inoltro). */
function defaultSignature(s: Pick<State, 'signaturePrefs'>, accountId: string, mode: ComposeMode): string | null {
  const p = s.signaturePrefs[accountId]
  if (!p) return null
  return mode === 'new' ? p.newId : p.replyId
}
