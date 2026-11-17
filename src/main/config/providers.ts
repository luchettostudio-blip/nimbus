/**
 * PROVIDER EMAIL — unico posto dove si configurano i preset.
 *
 * Per aggiungere un provider: copia un blocco, cambia `id` (univoco, minuscolo),
 * `label`, host/porte. Il logo è opzionale: metti un file in
 * `src/renderer/src/assets/providers/` e scrivine il nome in `logo`; senza logo
 * viene mostrato il monogramma con `color`.
 *
 * L'ordine dell'array è l'ordine nella griglia (i `featured` vanno sempre in testa).
 * Con un preset l'utente inserisce solo email e password; "Altro" mostra tutti i campi.
 * Lo username è sempre l'indirizzo email completo, con la stessa password per IMAP e SMTP.
 * Dopo ogni invio Nimbus salva una copia in "Inviata" con IMAP APPEND, tranne dove
 * `saveSentCopy: false` (provider che lo fanno già da soli).
 */
import type { ProviderPreset } from '../../core/models'

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'studio-marla',
    label: 'Studio Marla',
    description: 'Caselle su Register.it',
    featured: true,
    logo: 'studio-marla.svg',
    color: '#111827',
    monogram: 'SM',
    domains: [],
    // IMAP su SSL/TLS diretto.
    imap: { host: 'pop.securemail.pro', port: 993, secure: true },
    // SMTP principale su SSL/TLS diretto (465)…
    smtp: { host: 'authsmtp.securemail.pro', port: 465, secure: true },
    // …e, solo se la 465 fallisce o va in timeout, STARTTLS obbligatorio sulla 587.
    smtpFallbacks: [{ host: 'authsmtp.securemail.pro', port: 587, secure: false, requireTLS: true }],
    passwordHint: 'La password della casella (la stessa della webmail).'
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'Google, Workspace',
    logo: 'gmail.svg',
    color: '#ea4335',
    monogram: 'G',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    smtpFallbacks: [{ host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true }],
    // Gmail salva da solo la copia in "Posta inviata": un APPEND creerebbe un doppione.
    saveSentCopy: false,
    appPassword: { label: 'Crea una password per le app Google', url: 'https://myaccount.google.com/apppasswords' },
    passwordHint: 'Serve una password per le app (16 lettere), non la password del tuo account Google.'
  },
  {
    id: 'outlook',
    label: 'Outlook',
    description: 'Outlook.com, Hotmail, Live',
    logo: 'outlook.svg',
    color: '#0a64d6',
    monogram: 'O',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.it', 'hotmail.it'],
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false, requireTLS: true },
    saveSentCopy: false,
    appPassword: { label: 'Crea una password per le app Microsoft', url: 'https://account.live.com/proofs/AppPassword' },
    passwordHint: 'Microsoft sta disattivando l’accesso con password: se fallisce serve OAuth (in arrivo).'
  },
  {
    id: 'icloud',
    label: 'iCloud',
    description: 'iCloud, me.com, mac.com',
    logo: 'icloud.svg',
    color: '#3693f3',
    monogram: 'i',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false, requireTLS: true },
    appPassword: { label: 'Crea una password specifica per le app', url: 'https://account.apple.com/account/manage' },
    passwordHint: 'Serve una password specifica per le app generata dal tuo Apple ID.'
  },
  {
    id: 'other',
    label: 'Altro',
    description: 'IMAP / SMTP manuale',
    color: '#6b7280',
    monogram: '@',
    manual: true,
    domains: [],
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true }
  }
]

/** Preset ordinati per la griglia: quelli in evidenza per primi, poi nell'ordine del file. */
export function listProviders(): ProviderPreset[] {
  return [...PROVIDERS.filter((p) => p.featured), ...PROVIDERS.filter((p) => !p.featured)]
}
