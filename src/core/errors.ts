/**
 * Classificazione degli errori di connessione IMAP/SMTP e messaggi per l'utente.
 *
 * imapflow e nodemailer segnalano gli stessi problemi in modi diversi
 * (codici, flag, testo del messaggio): qui vengono ricondotti a pochi casi
 * comprensibili, ognuno con un titolo e un suggerimento in italiano.
 */
import type { ServerConfig } from './models'

export type MailErrorKind =
  | 'auth' // credenziali rifiutate
  | 'dns' // host inesistente / niente rete
  | 'refused' // porta chiusa (connessione rifiutata)
  | 'timeout' // nessuna risposta: porta filtrata da firewall/rete
  | 'tls' // SSL/TLS non riuscito (porta o modalità sbagliata, certificato)
  | 'unknown'

export type MailStage = 'imap' | 'smtp'

export function classifyError(err: unknown): MailErrorKind {
  const e = (err ?? {}) as {
    code?: string
    authenticationFailed?: boolean
    responseCode?: number
    serverResponseCode?: string
    message?: string
    responseText?: string
  }
  const code = String(e.code ?? '')
  const text = `${e.message ?? ''} ${e.responseText ?? ''}`

  if (e.authenticationFailed || code === 'EAUTH' || e.serverResponseCode === 'AUTHENTICATIONFAILED') return 'auth'
  if (e.responseCode === 535 || e.responseCode === 534) return 'auth'
  if (/\b(ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b/.test(code + ' ' + text) || code === 'EDNS') return 'dns'
  if (/\bECONNREFUSED\b/.test(code + ' ' + text)) return 'refused'
  if (/TIMEOUT|ETIMEDOUT|ETIMEOUT/i.test(code) || /timed? ?out/i.test(text)) return 'timeout'
  if (code === 'ETLS' || /ERR_SSL|ERR_TLS|CERT_|SELF_SIGNED|wrong version number|ssl|tls|certificate/i.test(code + ' ' + text)) return 'tls'
  if (/invalid (credentials|login)|authentication failed|login failed|AUTHENTICATIONFAILED/i.test(text)) return 'auth'
  return 'unknown'
}

/** Errore di configurazione account, con dettagli strutturati per la UI. */
export class MailSetupError extends Error {
  constructor(
    public readonly stage: MailStage,
    public readonly kind: MailErrorKind,
    public readonly title: string,
    message: string
  ) {
    super(message)
    this.name = 'MailSetupError'
  }
}

/** Costruisce il messaggio in italiano per un errore su un dato server. */
export function toSetupError(stage: MailStage, server: ServerConfig, err: unknown): MailSetupError {
  const kind = classifyError(err)
  const label = stage === 'imap' ? 'posta in arrivo (IMAP)' : 'posta in uscita (SMTP)'
  const where = `${server.host}:${server.port}`
  switch (kind) {
    case 'auth':
      return new MailSetupError(
        stage,
        kind,
        'Password errata',
        `Il server della ${label} ha rifiutato email o password. Controlla di averle scritte correttamente` +
          ` (se il provider lo richiede, usa una password per le app).`
      )
    case 'dns':
      return new MailSetupError(
        stage,
        kind,
        'Server irraggiungibile',
        `Non riesco a trovare ${server.host}. Controlla l'indirizzo del server della ${label} e la connessione a Internet.`
      )
    case 'refused':
      return new MailSetupError(
        stage,
        kind,
        'Porta chiusa',
        `${server.host} rifiuta le connessioni sulla porta ${server.port}. La porta della ${label} potrebbe essere sbagliata:` +
          ` controllala in "Impostazioni avanzate".`
      )
    case 'timeout':
      return new MailSetupError(
        stage,
        kind,
        'Porta bloccata',
        `Nessuna risposta da ${where}. Probabilmente la porta è bloccata da firewall, antivirus o dalla rete` +
          ` (succede spesso con l'SMTP in reti aziendali o pubbliche).`
      )
    case 'tls':
      return new MailSetupError(
        stage,
        kind,
        'Errore di connessione sicura',
        `La connessione cifrata con ${where} non è riuscita. Verifica in "Impostazioni avanzate" se la porta usa SSL/TLS diretto` +
          ` (993, 465) oppure STARTTLS (143, 587).`
      )
    default:
      return new MailSetupError(
        stage,
        kind,
        stage === 'imap' ? 'Errore IMAP' : 'Errore SMTP',
        `Connessione a ${where} non riuscita: ${(err as Error)?.message ?? String(err)}`
      )
  }
}
