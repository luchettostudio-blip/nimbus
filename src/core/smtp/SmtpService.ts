/**
 * SmtpService — invio messaggi tramite `nodemailer`, con fallback automatico.
 *
 * Prova i server nell'ordine [account.smtp, ...account.smtpFallbacks]:
 * se uno fallisce per problemi di RETE (timeout, porta chiusa/bloccata, TLS)
 * passa al successivo. Un errore di password invece si ferma subito
 * (provare un'altra porta non cambierebbe nulla).
 *
 * Il server che ha funzionato viene ricordato per la sessione, così gli invii
 * successivi non riaspettano il timeout della porta bloccata.
 *
 * Restituisce anche il sorgente RFC 822 generato, così il motore di sync può
 * salvarne una copia in "Inviata" per i provider che non lo fanno da soli.
 */
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { classifyError, toSetupError } from '../errors'
import type { Account, OutgoingMessage, ServerConfig } from '../models'

export interface SendResult {
  messageId: string
  raw: Buffer
  /** Il server effettivamente usato. */
  server: ServerConfig
}

const CONNECTION_TIMEOUT_MS = 12_000

/** accountId → indice del server che ha funzionato l'ultima volta (solo per la sessione). */
const preferred = new Map<string, number>()

export class SmtpService {
  constructor(
    private readonly account: Account,
    private readonly password: string
  ) {}

  private servers(): ServerConfig[] {
    return [this.account.smtp, ...(this.account.smtpFallbacks ?? [])]
  }

  private transport(server: ServerConfig) {
    return nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: server.secure,
      // STARTTLS obbligatorio se richiesto dal preset o sulla 587: mai password in chiaro.
      requireTLS: server.requireTLS ?? (!server.secure && server.port === 587),
      auth: { user: this.account.username, pass: this.password },
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: 60_000
    })
  }

  /**
   * Esegue `op` sul primo server che funziona. Ritorna anche il server usato.
   * In caso di fallimento totale lancia un `MailSetupError` riferito al server principale
   * (o a quello che ha dato errore di password, che è l'informazione più utile).
   */
  private async withFallback<T>(
    op: (server: ServerConfig) => Promise<T>,
    canTryNext: (err: unknown) => boolean = () => true
  ): Promise<{ result: T; server: ServerConfig }> {
    const list = this.servers()
    const start = preferred.get(this.account.id) ?? 0
    const order = [...list.keys()].sort((a, b) => (a === start ? -1 : b === start ? 1 : a - b))

    let firstError: { server: ServerConfig; err: unknown } | null = null
    for (const i of order) {
      const server = list[i]
      try {
        const result = await op(server)
        preferred.set(this.account.id, i)
        return { result, server }
      } catch (err) {
        if (classifyError(err) === 'auth') throw toSetupError('smtp', server, err)
        firstError ??= { server, err }
        if (!canTryNext(err)) break
      }
    }
    throw toSetupError('smtp', firstError!.server, firstError!.err)
  }

  /** Verifica le credenziali SMTP senza inviare nulla. Ritorna il server funzionante. */
  async verify(): Promise<ServerConfig> {
    const { server } = await this.withFallback((s) => this.transport(s).verify())
    return server
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const from = this.account.displayName
      ? { name: this.account.displayName, address: this.account.email }
      : this.account.email

    const mailOptions = {
      from,
      to: msg.to,
      cc: msg.cc.length ? msg.cc : undefined,
      bcc: msg.bcc.length ? msg.bcc : undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.contentBase64, 'base64'),
        cid: a.cid,
        contentDisposition: a.cid ? ('inline' as const) : ('attachment' as const)
      }))
    }

    // Genera il sorgente una volta sola: viene inviato e (eventualmente) salvato in "Inviata".
    const raw = await new MailComposer(mailOptions).compile().build()
    const envelope = { from: this.account.email, to: [...msg.to, ...msg.cc, ...msg.bcc] }
    // In invio si passa al server successivo solo se la connessione non è mai partita
    // (nodemailer marca questi errori con command "CONN"): altrimenti il messaggio
    // potrebbe essere già stato accettato e verrebbe spedito due volte.
    const failedBeforeSending = (err: unknown) => (err as { command?: string })?.command === 'CONN'
    const { result, server } = await this.withFallback((s) => this.transport(s).sendMail({ envelope, raw }), failedBeforeSending)
    return { messageId: result.messageId, raw, server }
  }
}
