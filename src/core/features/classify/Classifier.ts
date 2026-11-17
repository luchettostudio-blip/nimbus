/**
 * Inbox divisa: Persone / Newsletter / Notifiche. Tutto locale, niente sul server.
 *
 * Priorità (dalla più forte):
 *  1. regola imparata: l'utente ha spostato una mail di quel mittente in una scheda
 *  2. chiunque a cui ho scritto io (Posta inviata) → Persone
 *  3. euristiche sugli header:
 *     - piattaforme di email marketing o Precedence: bulk → Newsletter
 *     - noreply / notifications / Auto-Submitted / mail transazionali / social → Notifiche
 *     - List-Unsubscribe o List-Id → Newsletter
 *  4. tutto il resto → Persone
 */
import type Database from 'better-sqlite3'
import type { Account, InboxCategory, MessageSummary } from '../../models'

/** Domini di invio delle piattaforme di email marketing più diffuse. */
const ESP_DOMAINS = [
  'mailchimp.com', 'mcsv.net', 'mcdlv.net', 'list-manage.com', 'sendgrid.net', 'sendgrid.com', 'mailgun.org', 'mailgun.net',
  'sendinblue.com', 'brevo.com', 'klaviyo.com', 'klaviyomail.com', 'hubspot.com', 'hubspotemail.net', 'hs-email.net',
  'substack.com', 'constantcontact.com', 'createsend.com', 'cmail19.com', 'cmail20.com', 'mailjet.com', 'convertkit.com',
  'ck.page', 'activehosted.com', 'mailerlite.com', 'mlsend.com', 'beehiiv.com', 'emailoctopus.com', 'moosend.com',
  'getresponse.com', 'aweber.com', 'campaign-archive.com', 'exacttarget.com', 'salesforce-marketing.com', 'mktomail.com'
]

/** Mittenti di notifiche automatiche (parte locale dell'indirizzo). */
const NOTIFY_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|notifiche|notify|alerts?|avvisi|mailer[-_.]?daemon|postmaster|bounce[s]?|system|automated|robot|info[-_.]?noreply|account[-_.]?security|security|verify|verification)([-+._].*)?$/i

/** Domini social e di servizi che mandano quasi solo notifiche. */
const NOTIFY_DOMAINS = [
  'facebookmail.com', 'linkedin.com', 'instagram.com', 'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com', 'youtube.com',
  'accounts.google.com', 'github.com', 'gitlab.com', 'slack.com', 'atlassian.net', 'trello.com', 'notion.so', 'dropbox.com',
  'amazon.it', 'amazon.com', 'paypal.it', 'paypal.com', 'apple.com', 'microsoft.com', 'stripe.com', 'shopify.com'
]

/** Parole tipiche delle mail transazionali (oggetto). */
const TRANSACTIONAL = /\b(ricevuta|conferma|confermato|confermata|codice|verifica|verification|otp|ordine|order|spedizion[ei]|spedito|consegna|consegnato|tracking|pagamento|payment|receipt|invoice|password|accesso|login|sign[- ]?in|security alert|nuovo accesso|iscrizione confermata|prenotazione|booking|biglietto|ticket)\b/i

export function heuristicCategory(m: MessageSummary): InboxCategory {
  const addr = (m.from?.address ?? '').toLowerCase()
  const [local = '', domain = ''] = addr.split('@')
  const fromDomain = (d: string) => domain === d || domain.endsWith(`.${d}`)

  if (ESP_DOMAINS.some(fromDomain) || m.precedence === 'bulk') return 'newsletter'
  if (
    NOTIFY_LOCAL.test(local) ||
    (m.autoSubmitted && m.autoSubmitted !== 'no') ||
    NOTIFY_DOMAINS.some(fromDomain) ||
    TRANSACTIONAL.test(m.subject)
  ) {
    return 'notifications'
  }
  if (m.listUnsubscribe || m.listId || m.precedence === 'list') return 'newsletter'
  return 'people'
}

export class Classifier {
  constructor(
    private readonly db: Database.Database,
    private readonly accounts: () => Account[],
    private readonly sentFolderOf: (accountId: string) => string | undefined
  ) {}

  /** Classifica (e salva) le mail; dalla Posta inviata impara i "miei contatti". */
  apply(list: MessageSummary[]): void {
    if (list.length === 0) return
    const tx = this.db.transaction(() => {
      const newContacts = new Map<string, Set<string>>()
      for (const m of list) {
        const sent = this.sentFolderOf(m.accountId)
        const me = this.accounts().find((a) => a.id === m.accountId)?.email.toLowerCase()
        if (m.folder === sent || (me && m.from?.address.toLowerCase() === me)) {
          for (const to of m.to) {
            const a = to.address.toLowerCase()
            if (!a || a === me) continue
            if (this.addContact(m.accountId, a, m.date)) {
              newContacts.set(m.accountId, (newContacts.get(m.accountId) ?? new Set()).add(a))
            }
          }
        }
        const cat = this.categoryFor(m)
        this.db.prepare('UPDATE messages SET category = ? WHERE account_id = ? AND folder = ? AND uid = ?').run(cat, m.accountId, m.folder, m.uid)
        m.category = cat
      }
      // Un nuovo contatto (gli ho scritto): le sue mail passano in Persone, salvo regole esplicite.
      for (const [accountId, addrs] of newContacts) {
        for (const a of addrs) {
          if (this.ruleFor(accountId, a)) continue
          this.db.prepare(`UPDATE messages SET category = 'people' WHERE account_id = ? AND lower(from_address) = ?`).run(accountId, a)
        }
      }
    })
    tx()
  }

  categoryFor(m: MessageSummary): InboxCategory {
    const addr = (m.from?.address ?? '').toLowerCase()
    return this.ruleFor(m.accountId, addr) ?? (this.isContact(m.accountId, addr) ? 'people' : heuristicCategory(m))
  }

  /** L'utente sposta una mail in un'altra scheda: da ora tutto quel mittente va lì. */
  learn(accountId: string, address: string, category: InboxCategory): number {
    const a = address.toLowerCase()
    this.db
      .prepare(
        `INSERT INTO sender_rules (account_id, address, category, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id, address) DO UPDATE SET category = excluded.category, created_at = excluded.created_at`
      )
      .run(accountId, a, category, Date.now())
    return this.db.prepare('UPDATE messages SET category = ? WHERE account_id = ? AND lower(from_address) = ?').run(category, accountId, a).changes
  }

  /** Registra destinatari di un invio come contatti (chiamato anche dall'outbox). */
  addContacts(accountId: string, addresses: string[]): void {
    for (const raw of addresses) {
      const a = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase()
      if (!a.includes('@')) continue
      if (this.addContact(accountId, a, Date.now()) && !this.ruleFor(accountId, a)) {
        this.db.prepare(`UPDATE messages SET category = 'people' WHERE account_id = ? AND lower(from_address) = ?`).run(accountId, a)
      }
    }
  }

  /** Classifica le mail rimaste senza categoria (es. dopo la migrazione). */
  backfill(rows: MessageSummary[]): void {
    this.apply(rows)
  }

  private ruleFor(accountId: string, address: string): InboxCategory | null {
    const r = this.db.prepare('SELECT category FROM sender_rules WHERE account_id = ? AND address = ?').get(accountId, address) as
      | { category: InboxCategory }
      | undefined
    return r?.category ?? null
  }

  private isContact(accountId: string, address: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sent_contacts WHERE account_id = ? AND address = ?').get(accountId, address)
  }

  /** true se il contatto è nuovo. */
  private addContact(accountId: string, address: string, at: number): boolean {
    const existed = this.isContact(accountId, address)
    this.db
      .prepare(
        `INSERT INTO sent_contacts (account_id, address, count, last_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(account_id, address) DO UPDATE SET count = count + 1, last_at = max(last_at, excluded.last_at)`
      )
      .run(accountId, address, at)
    return !existed
  }
}
