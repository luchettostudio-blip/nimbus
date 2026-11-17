# Nimbus

Client email desktop per Windows 11, minimale e veloce, in stile Superhuman / Linear.
Electron + Vite + React + TypeScript + Tailwind · IMAP (imapflow) · SMTP (nodemailer) · cache SQLite.
Multi-account con inbox unificata.

## Requisiti

- Windows 10/11 (il Mica richiede Windows 11; su Windows 10 si usa uno sfondo pieno)
- Node.js 20 o superiore (testato con Node 25)
- Per ricompilare `better-sqlite3` se manca un binario precompilato: Visual Studio Build Tools con "Sviluppo di applicazioni desktop C++" (di solito non serve)

## Avvio in sviluppo

```bash
npm install
```

```bash
npm run dev
```

`npm install` ricompila automaticamente `better-sqlite3` per la versione di Electron (`postinstall` → `electron-rebuild`).
Se cambi versione di Electron o vedi l'errore `NODE_MODULE_VERSION`:

```bash
npm run rebuild
```

`npm run dev` avvia Vite con hot reload del renderer; le modifiche a `src/main` e `src/core` riavviano Electron.
In sviluppo gli errori del renderer compaiono anche nel terminale. Controllo dei tipi:

```bash
npm run typecheck
```

## Creare l'installer `.exe`

```bash
npm run dist
```

Risultato in `dist/`:
- `Nimbus Setup 0.1.0.exe` — installer (scelta della cartella, collegamento su desktop e menu Start)
- `win-unpacked/Nimbus.exe` — versione portabile non installata

L'installer non è firmato: al primo avvio Windows SmartScreen mostra "PC protetto" → **Ulteriori informazioni → Esegui comunque**.
Per distribuirlo ad altri serve un certificato di firma del codice (`win.certificateFile` in `electron-builder.config.cjs`).
La versione si cambia in `package.json` (`version`).

## Identità visiva

Nome, appId, palette dei colori (dark e light), logo e icona stanno tutti in **`brand/`** — vedi [brand/README.md](brand/README.md).
I valori attuali sono placeholder: sostituisci `brand/brand.json`, `brand/logo.svg`, `brand/icon.ico`, `brand/icon.png` e ricompila.

## Provider

Tutti i preset sono in **[src/main/config/providers.ts](src/main/config/providers.ts)**: per aggiungerne uno copia un blocco e cambia
`id`, `label` e host/porte. I loghi vanno in `src/renderer/src/assets/providers/` col nome indicato in `logo`
(se il file manca si vede un monogramma colorato).

| Provider | IMAP | SMTP |
|---|---|---|
| **Studio Marla** (Register.it) | `pop.securemail.pro:993` SSL/TLS | `authsmtp.securemail.pro:465` SSL/TLS → fallback automatico `587` STARTTLS obbligatorio |
| Gmail | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL → fallback `587` STARTTLS |
| Outlook | `outlook.office365.com:993` SSL | `smtp-mail.outlook.com:587` STARTTLS |
| iCloud | `imap.mail.me.com:993` SSL | `smtp.mail.me.com:587` STARTTLS |
| Altro | manuale | manuale |

Con un preset si inseriscono solo email e password; lo username è l'indirizzo completo e la password è la stessa per IMAP e SMTP.
"Impostazioni avanzate" mostra host e porte già compilati e modificabili.

**Fallback SMTP**: si passa alla 587 solo se la 465 non risponde, rifiuta la connessione o fallisce l'SSL. Una password sbagliata
non fa partire il fallback. In invio il fallback scatta solo se la connessione non è mai partita, così un messaggio
non viene spedito due volte. Il server che ha funzionato viene ricordato fino alla chiusura dell'app.

**Verifica all'aggiunta**: IMAP e SMTP vengono testati subito; gli errori sono in italiano e dicono quale server ha fallito:
*Password errata*, *Server irraggiungibile*, *Porta chiusa*, *Porta bloccata* (timeout dopo 15 s), *Errore di connessione sicura*.

## Testare con una casella reale

1. Avvia l'app (`npm run dev`, oppure installa `dist\Nimbus Setup 0.1.0.exe`).
2. Nella griglia scegli **Studio Marla** e inserisci indirizzo completo e password della casella (la stessa della webmail).
3. Premi **Aggiungi account**: in pochi secondi verifica IMAP e SMTP. Se compare un errore, il riquadro rosso dice se è IMAP o SMTP e cosa controllare.
4. Controlla che arrivi la Posta in arrivo, apri un messaggio (con immagini esterne bloccate), segnalo come letto (`U`), archivia (`E`).
5. **Invio**: premi `C`, scrivi a un tuo altro indirizzo e invia con `Ctrl+Enter`. Verifica che arrivi e che compaia in *Inviata*.
6. **Tempo reale**: con l'app aperta mandati una mail da un altro account o dal telefono: deve comparire in pochi secondi; con la finestra non in primo piano arriva anche la notifica di Windows.
7. **Fallback 587 (opzionale)**: per simulare una rete che blocca la 465, apri PowerShell **come amministratore** e crea una regola
   temporanea del firewall:

   ```powershell
   New-NetFirewallRule -DisplayName "Test Nimbus blocca 465" -Direction Outbound -Protocol TCP -RemotePort 465 -Action Block
   ```

   Riavvia Nimbus e invia una mail: dopo il timeout sulla 465 (circa 12 s) parte dalla 587 e gli invii successivi sono immediati.
   Poi rimuovi la regola:

   ```powershell
   Remove-NetFirewallRule -DisplayName "Test Nimbus blocca 465"
   ```

   Nota: se in *Impostazioni avanzate* modifichi a mano l'SMTP, il fallback del preset viene disattivato (vale quello che hai scritto tu).
8. **Multi-account**: aggiungi una seconda casella (*Aggiungi account* in basso nella sidebar). Compare **Tutte le caselle**
   (inbox unificata, `Ctrl+0`); ogni account si apre con `Ctrl+1`, `Ctrl+2`, … Nel composer scegli il mittente dal menu "da";
   le risposte partono sempre dall'account che ha ricevuto il messaggio.

Per ripartire da zero chiudi l'app e cancella `%APPDATA%\Nimbus` (in sviluppo e installata usano la stessa cartella).

### Password per le app (Gmail)

Gmail non accetta la password normale nei client IMAP: serve una **password per le app**.
1. Attiva la Verifica in due passaggi: <https://myaccount.google.com/signinoptions/twosv>.
2. Apri <https://myaccount.google.com/apppasswords>, scrivi un nome (es. `Nimbus`) e premi **Crea**.
3. Copia il codice di 16 lettere (mostrato una volta sola) e usalo come password in Nimbus.

Outlook.com sta dismettendo l'accesso IMAP con password: se fallisce, serve OAuth2 (prossima fase).

## Scorciatoie

| Tasto | Azione |
|---|---|
| `Ctrl` `K` | Command palette (comandi, cartelle, account, ricerca, tema) |
| `Ctrl` `0` | Inbox unificata (con 2+ account) |
| `Ctrl` `1`…`9` | Passa all'account 1…9 |
| `J` / `K` (o ↓ / ↑) | Messaggio successivo / precedente |
| `E` | Archivia |
| `#` / `Canc` | Elimina |
| `R` · `A` · `F` | Rispondi · Rispondi a tutti · Inoltra |
| `C` | Scrivi nuovo messaggio |
| `U` | Letto / non letto |
| `S` | Speciale (stella) |
| `/` | Cerca (in tutti gli account) |
| `G` `A` · `G` `I` · `G` `S` | Inbox unificata · Posta in arrivo · Inviata |
| `Ctrl` `Enter` | Invia (nel composer) |
| `Esc` | Chiudi / deseleziona |

## Struttura

```
brand/          identità visiva: brand.json (nome, appId, colori), logo, icone
src/
├─ core/        logica email portabile (IMAP, SMTP, SQLite, sync, errori) — vedi src/core/README.md
├─ shared/      contratto IPC tipizzato fra main e renderer
├─ main/        finestra Mica, IPC, safeStorage, notifiche, config/providers.ts
├─ preload/     ponte sicuro (contextBridge) con canali in whitelist
└─ renderer/    UI React (sidebar, lista virtualizzata, vista, composer, palette, onboarding)
```

## Sicurezza

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; il renderer parla col main solo tramite canali IPC in whitelist,
  e il main accetta richieste solo dalla finestra principale.
- Password cifrate con `safeStorage` (DPAPI di Windows, legate al tuo utente Windows) in `%APPDATA%\Nimbus\credentials.json`;
  mai salvate in chiaro, mai rimandate al renderer.
- SMTP: sulla 587 STARTTLS è obbligatorio, la password non viaggia mai in chiaro.
- HTML delle email sanificato con DOMPurify e mostrato in un iframe sandbox senza script, con una Content-Security-Policy dedicata.
- Immagini esterne bloccate di default (niente tracking pixel) finché non premi "Mostra immagini".
- I link si aprono nel browser di sistema.

## Dati locali

Tutto in `%APPDATA%\Nimbus\`: `mail.db` (cache SQLite) e `credentials.json` (password cifrate).
