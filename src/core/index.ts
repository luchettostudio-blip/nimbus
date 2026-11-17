/**
 * Punto d'ingresso del modulo core (logica email indipendente dalla UI).
 * Vedi README.md in questa cartella per l'architettura.
 */
export * from './models'
export { ImapService } from './imap/ImapService'
export { SmtpService } from './smtp/SmtpService'
export { MailStore } from './store/MailStore'
export { SyncEngine, type CredentialStore } from './sync/SyncEngine'
