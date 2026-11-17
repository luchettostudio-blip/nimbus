# CLAUDE.md — Nimbus

Guida per chi (persona o agente) lavora su questo progetto. Leggila prima di modificare il codice.
Lingua del progetto: **italiano** (UI, commenti, messaggi di commit, documentazione).

---

## 1. Cos'è

**Nimbus** è un client email desktop **generico** (IMAP/SMTP), minimale e veloce, in stile Superhuman / Linear.
Nato su **Windows 11** (Electron); in futuro verrà riscritto in **SwiftUI per macOS** riusando la stessa
architettura: per questo tutta la logica email sta in `src/core`, senza dipendenze da Electron o React.

- Non è un'app dedicata a un'azienda: **Studio Marla** è solo il primo provider della griglia, in evidenza.
- Identità visiva in `brand/` (nome, appId `com.nimbus.mail`, colori, logo, icona). Logo e icona sono definitivi;
  i colori sono ancora placeholder.
- Proprietario: Luca (`luca@studiomarla.it`).

## 2. Comandi

```bash
npm install            # installa e ricompila better-sqlite3 per Electron (postinstall → electron-rebuild)
npm run dev            # sviluppo con hot reload (electron-vite)
npm run typecheck      # tsc su main/preload/core e renderer
npm run build          # build di produzione in out/
npm run dist           # installer Windows NSIS → dist/Nimbus Setup <versione>.exe
npm run dist:mac       # DMG macOS (configurato ma MAI provato: vedi §11)
npm run rebuild        # se compare NODE_MODULE_VERSION (cambio versione Electron/Node)
```

Versione dell'app: `package.json` → `version`. Dati utente: `%APPDATA%\Nimbus\` (Windows), `~/Library/Application Support/Nimbus/` (macOS):
`mail.db` (SQLite), `credentials.json` (password cifrate), `attachments/` (cache).

## 3. Stack

| Ambito | Scelta |
|---|---|
| Shell | Electron 45 + electron-vite 6 (Vite 7), TypeScript 5.9 |
| UI | React 19, Tailwind 4 (`@tailwindcss/vite`), Framer Motion, lucide-react, zustand, @tanstack/react-virtual, font Inter (locale) |
| Posta | `imapflow` (IMAP, IDLE), `mailparser`, `nodemailer` (SMTP + `MailComposer`) |
| Dati | `better-sqlite3` (sincrono, WAL, FTS5), migrazioni in `src/core/store/schema.ts` |
| Sicurezza | `safeStorage` di Electron (DPAPI su Windows, Keychain su macOS), DOMPurify, iframe sandbox |
| Allegati | `pdfjs-dist` 6 (render su canvas + text layer) |
| Packaging | electron-builder (`electron-builder.config.cjs`, legge `brand/brand.json`) |

## 4. Architettura delle cartelle

```
brand/                       identità visiva: brand.json (nome, appId, palette dark/light), logo.svg, icon.ico/png
electron-builder.config.cjs  installer (nome/icona da brand.json)
src/
├─ core/                     LOGICA EMAIL PORTABILE — niente Electron/React (vedi src/core/README.md)
│  ├─ models.ts              tipi di dominio (solo dati, serializzabili)
│  ├─ errors.ts              errori di rete → messaggi italiani (MailSetupError)
│  ├─ imap/ImapService.ts    IMAP: 2 connessioni (comandi + IDLE), fetch, flag, move, append, search
│  ├─ smtp/SmtpService.ts    SMTP con fallback fra server (465 → 587)
│  ├─ compose/buildOutgoing  bozza → MIME (testo + firma CID + citazione)
│  ├─ store/MailStore.ts     cache SQLite + hook onUpsert; schema.ts = migrazioni
│  ├─ sync/SyncEngine.ts     orchestratore: sessioni per account, sync, azioni, eventi
│  └─ features/              signatures, outbox, snooze, attachments, search, threads, classify, unsubscribe
├─ shared/ipc.ts             contratto IPC tipizzato (canali invoke + eventi) usato da main, preload e renderer
├─ main/                     processo principale Electron
│  ├─ index.ts               finestra (Mica, titleBarOverlay), tray, single-instance, avvio nascosto
│  ├─ ipc.ts                 handler IPC → SyncEngine (solo inoltro + errori leggibili)
│  ├─ config/providers.ts    PRESET DEI PROVIDER (unico posto)
│  ├─ credentials.ts         CredentialStore su safeStorage
│  ├─ platform/              nativeImage (immagini firme), net.fetch (download immagini, POST One-Click)
│  ├─ attachments.ts         apri/salva allegati (blocco eseguibili)
│  ├─ notifications.ts, tray.ts
├─ preload/index.ts          contextBridge: window.api.invoke/on con whitelist
└─ renderer/                 UI React
   └─ src/  App.tsx, store.ts (zustand), components/ (lista, vista, composer, palette, settings,
            thread/, search/, viewer/, unsubscribe/), lib/ (api, sanitize, signatureHtml, quotes, schedule…)
```

Regole:
- `src/core` non importa mai da `electron`/React. La piattaforma entra da interfacce: `CredentialStore`,
  `PlatformServices` (immagini, POST One-Click, apertura link) e gli `*Host` delle feature.
- Il renderer non ha Node: tutto passa da `window.api` (preload) con i canali dichiarati in `src/shared/ipc.ts`.
  Per aggiungere un canale: tipo in `IpcInvokeMap` + nome in `INVOKE_CHANNELS` + handler in `main/ipc.ts`.
- Gli errori viaggiano come valore `{ok:false, error, title?, stage?}`; il renderer li riceve come `IpcError`.
- Il renderer può importare dal core solo file puri inclusi in `tsconfig.web.json`
  (`models.ts`, `features/search/query.ts`, `features/unsubscribe/listUnsubscribe.ts`).

## 5. Database SQLite (schema v3)

Migrazioni versionate in `src/core/store/schema.ts` (`PRAGMA user_version`). **Mai modificare una migrazione
rilasciata: aggiungerne una nuova** (c'è già un'installazione reale in uso).

| Tabella | Contenuto |
|---|---|
| `accounts` | config account in JSON (senza password) |
| `folders` | cartelle con ruolo SPECIAL-USE, conteggi, UIDVALIDITY |
| `messages` | riepiloghi: header base + `in_reply_to`, `refs`, `thread_id`, `category`, `list_unsubscribe(_post)`, `list_id`, `precedence`, `auto_submitted`, `woke_at`, `attachment_names`, `indexed` |
| `bodies` | corpo completo in JSON (cache) |
| `kv` | impostazioni (`settings` = `AppSettings`), tema |
| `signatures`, `signature_images` (BLOB), `account_prefs` | firme e predefinite |
| `outbox` | annulla invio + invio programmato |
| `snoozes` | mail rimandate (per Message-ID) |
| `attachment_cache` | percorsi dei file allegati su disco |
| `messages_fts` | FTS5 (rowid = rowid di `messages`), trigger su insert/delete |
| `thread_links` | Message-ID → thread_id |
| `sender_rules`, `sent_contacts` | inbox divisa: regole imparate, chi ho scritto io |
| `unsubscriptions` (+`name` in v3), `blocked_senders` | disiscrizioni e blocchi |

## 6. Come funziona

### Sync (`SyncEngine`)
- **Cache-first**: la UI legge sempre da SQLite; il sync aggiorna e poi emette eventi (`SyncEvent` → IPC `sync:event`).
- Per account: connessione **comandi** (lock per cartella) + connessione **IDLE** su INBOX (`mailboxOpen` senza lock:
  con un lock imapflow non entra in IDLE). Polling ogni 3 min come rete di sicurezza; riconnessione con backoff
  2s→60s e alla ripresa dalla sospensione.
- Prima apertura cartella: ultimi 150 messaggi; poi solo `UID > max` + riconciliazione flag/eliminazioni.
  UIDVALIDITY cambiata → cache della cartella azzerata. Inbox e Posta inviata vengono sincronizzate all'avvio.
- Ogni riepilogo scarica anche 12 KB di sorgente (anteprima + testo per l'indice) e gli header extra
  (References, List-Unsubscribe, List-Id, Precedence, Auto-Submitted).
- Azioni ottimistiche (letto, archivia, elimina): prima la cache, poi il server; se fallisce si risincronizza.
- `MailStore.onUpsert`: ogni mail salvata (da qualunque fonte) passa per thread, classificazione e blocchi.

### Thread (`features/threads`)
JWZ incrementale: la mail porta Message-ID + References + In-Reply-To; `thread_links` mappa ogni ID al thread;
se una mail collega thread diversi, si fondono. Fallback sull'oggetto normalizzato (Re:, R:, Fwd:, I:…) **solo**
se mancano References e In-Reply-To. La lista mostra una riga per conversazione (conteggi su tutte le cartelle,
quindi incluse le mie risposte in Inviata). Risposte: `References` = catena completa.

### Ricerca (`features/search`)
FTS5 su mittente, destinatari, oggetto, corpo, nomi allegati (`unicode61 remove_diacritics`). Parser con operatori
italiani (`da:`, `a:`, `oggetto:`, `ha:allegato`, `ha:pdf`, `prima:`, `dopo:`, `in:`, `non:letto`, `è:speciale`,
`account:`, `"frase"`), prefisso sulle parole libere. Indicizzazione in background degli ultimi N mesi
(`settings.indexMonths`, default 12) a lotti da 40; "Cerca anche sul server" = IMAP SEARCH + download.

### Snooze (`features/snooze/Snoozer`)
MOVE nella cartella IMAP `Nimbus/Rimandate` (creata con `mailboxCreate(['Nimbus','Rimandate'])`, che rispetta
prefisso e separatore del server). Riferimento per **Message-ID** (gli UID cambiano a ogni spostamento).
Al risveglio: MOVE in INBOX, non letta, `woke_at` (ordinamento in cima + etichetta), notifica.
All'avvio le scadute vengono risvegliate subito; la notifica "nuova mail" dell'IDLE viene soppressa.

### Invio (`features/outbox/Outbox`)
Un'unica coda persistente: **annulla invio** (`kind='undo'`, parte dopo 5/10/20/30 s) e **programmati**
(`kind='scheduled'`). Un solo timer verso la prossima scadenza. All'avvio: programmati scaduti da >2 min →
`missed` (si chiede all'utente; notifica + banner in "In programma"); "annulla invio" rimasti in coda → partono.
Retry dei programmati (3 tentativi, 2 min). In invio il fallback SMTP scatta solo per errori di connessione
(`command === 'CONN'`) per non spedire due volte. Dopo l'invio: **IMAP APPEND in Posta inviata**, salvo
`saveSentCopy: false` (Gmail, Outlook lo fanno già). Chiudere la finestra la nasconde nella tray: gli invii partono comunque.

### Firme
HTML con `<img src="cid:…">`; immagini ridimensionate a 300px (nativeImage) e salvate come BLOB; all'invio
diventano allegati inline. HTML incollato: stili calcolati resi inline in un iframe nascosto, DOMPurify con
whitelist, `<p>`→`<div>`, tabella di layout. Nel messaggio: testo → firma → citazione.

### Inbox divisa e disiscrizione
Classificazione locale: regola imparata > contatto a cui ho scritto > euristiche (ESP/bulk → Newsletter;
noreply/Auto-Submitted/transazionali/social → Notifiche; List-* → Newsletter) > Persone.
Disiscrizione: One-Click RFC 8058 (POST https dal main) > mailto (mail dall'account giusto) > browser.
Dopo 7 giorni, se il mittente scrive ancora → proposta di blocco (auto-cestino).

## 7. Provider (`src/main/config/providers.ts`)

| Provider | IMAP | SMTP | Note |
|---|---|---|---|
| **Studio Marla** (Register.it, in evidenza) | `pop.securemail.pro:993` SSL | `authsmtp.securemail.pro:465` SSL → fallback `587` STARTTLS obbligatorio | username = email completa, stessa password; APPEND in Inviata necessario |
| Gmail | `imap.gmail.com:993` | `smtp.gmail.com:465` → `587` | password per le app; `saveSentCopy: false` |
| Outlook | `outlook.office365.com:993` | `smtp-mail.outlook.com:587` STARTTLS | Microsoft sta togliendo le password IMAP (serve OAuth2) |
| iCloud | `imap.mail.me.com:993` | `smtp.mail.me.com:587` | password specifica per le app |
| Altro | manuale | manuale | |

I server Studio Marla sono stati verificati raggiungibili (handshake TLS, certificati validi), mai con un login reale.
Loghi provider: file in `src/renderer/src/assets/providers/` (se mancano: monogramma).

## 8. Decisioni prese (e perché)

- **Core separato da Electron** → port SwiftUI (ogni classe ha l'equivalente Swift indicato in `src/core/README.md`).
- **Cache-first + aggiornamenti ottimistici** → app istantanea anche con server lenti.
- **Due connessioni IMAP** → IDLE non blocca i comandi.
- **Thread/classificazione nell'hook `onUpsert`** → nessun punto d'ingresso dimentica di aggiornarli.
- **Snooze su cartella IMAP** (non solo locale) → la mail sparisce anche da webmail/telefono.
- **Outbox in SQLite e main process vivo nella tray** → gli invii programmati sopravvivono a chiusure e riavvii.
- **APPEND in Inviata** → Register.it non salva le mail inviate via SMTP.
- **Firme con immagini CID** → visibili anche nei client che bloccano le immagini remote.
- **Email HTML in iframe sandbox senza script + CSP; immagini remote bloccate di default** → privacy/tracking.
- **Password solo in `safeStorage`**, mai nel DB né nel renderer dopo l'onboarding.
- **Fine riga LF** (`.gitattributes`) → stesso repository su Windows e macOS.
- **Patch del codice**: gli script Python su Windows convertono LF→CRLF se non si usa `newline=''`;
  attenzione anche agli escape `\r\n` dentro stringhe Python non raw.

## 9. Cose ancora da fare

- **Mai testato con una casella reale** (Studio Marla/Register.it, Gmail): primo passo consigliato.
- One-Click unsubscribe verificato solo con endpoint simulato e con sito irraggiungibile.
- Composer solo testo semplice: niente formattazione, **niente allegati in uscita**, niente bozze salvate sul server.
- OAuth2 (Outlook/Gmail senza password per le app).
- Aggiornamento automatico (electron-updater + GitHub Releases); installer non firmato (SmartScreen).
- Colori del brand definitivi (`brand/brand.json`).
- Cache allegati senza pulizia periodica (solo alla cancellazione del messaggio).
- Anteprima HEIC non supportata dal motore di Chromium (mostra "Apri con app").
- **Test automatici non sono nel repository**: durante lo sviluppo esistevano server IMAP/SMTP finti
  (hoodiecrow-imap + smtp-server) e harness Electron per ogni funzione, rimasti in una cartella temporanea
  di Windows. Andrebbero ricreati in `tests/` (server finto + suite del core + harness UI).

## 10. Bug noti / limiti

- Su macOS la barra del titolo è pensata per Windows: `pr-[150px]` riserva spazio ai pulsanti a destra,
  mentre su Mac i semafori sono a sinistra e coprono il logo. `backgroundMaterial: 'mica'` e
  `setAppUserModelId` sono solo Windows.
- Conteggi delle schede = non lette **in cache**, non quelle totali del server.
- Il classificatore incrementa `sent_contacts.count` anche quando la stessa mail inviata viene risalvata.
- Snooze/thread richiedono il Message-ID: mail senza Message-ID non si possono rimandare e restano conversazioni singole.
- La proposta di blocco ("ti scrive ancora") è verificata nel motore, non a schermo.

## 11. Spostarsi su Mac

1. Installa Node 20+ e Xcode Command Line Tools (`xcode-select --install`), clona il repo, `npm install`.
2. `npm run dev` dovrebbe partire; da sistemare: barra del titolo (semafori a sinistra, `titleBarStyle: 'hiddenInset'`,
   niente `titleBarOverlay`), materiale (`vibrancy` al posto di Mica), icona tray (template image monocromatica),
   chiusura nella barra dei menu.
3. I dati di Windows **non si trasferiscono**: le password sono cifrate con DPAPI e illeggibili su Mac.
   Si riaggiungono gli account; firme e impostazioni vanno ricreate.
4. `npm run dist:mac` per il DMG (non firmato/notarizzato: Gatekeeper chiederà conferma).
