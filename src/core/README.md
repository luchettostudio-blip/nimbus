# `src/core` — logica email portabile

Questo modulo contiene **tutta** la logica di dominio del client: niente Electron, niente React.
È pensato per essere riscritto 1:1 in Swift per la futura app SwiftUI su macOS.

```
core/
├─ models.ts             tipi di dominio (solo dati), incluso ProviderPreset
├─ errors.ts             classificazione errori di rete + messaggi in italiano
├─ imap/ImapService.ts   protocollo IMAP (imapflow + mailparser)
├─ smtp/SmtpService.ts   invio (nodemailer) con fallback fra più server
├─ store/MailStore.ts    cache SQLite (better-sqlite3)
└─ sync/SyncEngine.ts    orchestrazione + eventi verso la UI
```

## Flusso dei dati

```
 UI ──(azione)──▶ SyncEngine ──▶ MailStore (aggiornamento ottimistico) ──▶ evento → UI
                     │
                     └──▶ ImapService / SmtpService (server) ── errore? → risincronizza cartella

 IDLE (connessione dedicata su INBOX) ──▶ SyncEngine.syncFolder(notify) ──▶ evento 'new-mail'
```

1. **Cache-first** — la UI legge sempre da `MailStore`: l'app si apre istantaneamente con i dati dell'ultima sessione.
2. **Sync incrementale** — prima apertura di una cartella: ultimi 150 messaggi. Poi solo `UID > max(uid in cache)`
   più una riconciliazione leggera dei flag e delle eliminazioni. Se cambia `UIDVALIDITY` la cache della cartella viene azzerata.
3. **Ottimistico** — letto / archivia / elimina modificano subito la cache; se il server rifiuta, la cartella si risincronizza.
4. **Push** — `ImapService` tiene una seconda connessione in IDLE su INBOX; un polling ogni 3 minuti fa da rete di sicurezza.
   Riconnessione automatica con backoff esponenziale (2s → 60s) e alla ripresa dalla sospensione.

5. **Multi-account** — ogni account ha la sua sessione (connessioni, code, riconnessione). L'inbox unificata è una query
   sulla cache (`messages` ⨝ `folders` con `role = 'inbox'`); un messaggio si identifica con `(accountId, folder, uid)`.
6. **Errori leggibili** — `errors.ts` riconduce i codici di imapflow/nodemailer a pochi casi (`auth`, `dns`, `refused`,
   `timeout`, `tls`) e `MailSetupError` porta titolo, server (IMAP/SMTP) e suggerimento.
7. **Fallback SMTP** — `SmtpService` prova `[smtp, ...smtpFallbacks]`; passa al successivo solo per errori di rete
   (mai per password errata) e, in invio, solo se la connessione non è mai partita.

I preset dei provider sono configurazione dell'app e vivono in `src/main/config/providers.ts` (non nel core).

## Componenti

| TypeScript | Responsabilità | Equivalente Swift previsto |
|---|---|---|
| `models.ts` | `Account`, `Folder`, `MessageSummary`, `MessageBody`, `OutgoingMessage`, `SyncEvent`, `ProviderPreset` | `struct … : Codable, Identifiable`; `SyncEvent` → `enum` con associated values |
| `errors.ts` | `classifyError`, `MailSetupError`, `toSetupError` | `enum MailErrorKind` + `struct MailSetupError: LocalizedError` |
| `ImapService` | connessione comandi + connessione IDLE, fetch riepiloghi/corpi, flag, move, delete, append | `actor ImapService` su swift-nio-imap o MailCore2 |
| `SmtpService` | composizione MIME e invio, restituisce il sorgente RFC 822 | `actor SmtpService` (MailCore2 `MCOSMTPSession` o SwiftSMTP) |
| `MailStore` | tabelle `accounts`, `folders`, `messages`, `bodies`, `kv` | GRDB.swift (stesso schema SQL) o SwiftData |
| `SyncEngine` | coordina tutto, code per cartella, eventi | `@MainActor final class SyncEngine: ObservableObject` o `actor` + `AsyncStream<SyncEvent>` |
| `CredentialStore` (interfaccia async) | salvataggio password | Keychain (`SecItemAdd` / `SecItemCopyMatching`) |

## Regole del modulo

- **Nessun import da `electron`** (né da React). Le dipendenze di piattaforma entrano tramite interfacce (`CredentialStore`).
- I modelli sono **solo dati** serializzabili (passano via IPC e finiscono in SQLite come JSON/colonne).
- Le password non fanno mai parte di `Account`: vivono solo nel `CredentialStore`.
- Tutti i metodi di rete sono `async` e lanciano eccezioni; il chiamante (IPC) le converte in messaggi leggibili.

## Schema SQLite (v1)

```sql
accounts (id PK, json, created_at)
folders  (account_id, path, name, role, delimiter, unread, total, uid_validity,  PK(account_id, path))
messages (account_id, folder, uid, message_id, subject, from_name, from_address, to_json,
          date, snippet, seen, flagged, has_attachments,                       PK(account_id, folder, uid))
bodies   (account_id, folder, uid, json,                                        PK(account_id, folder, uid))
kv       (key PK, value)
```

La versione dello schema è in `PRAGMA user_version`; le migrazioni future vanno aggiunte in `MailStore.migrate()`.
