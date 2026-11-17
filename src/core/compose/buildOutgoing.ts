/**
 * Trasforma la bozza del compositore in un messaggio MIME compatibile con
 * Gmail e Outlook: HTML con soli stili inline, firma (con immagini CID)
 * sopra il testo citato, e alternativa in solo testo.
 */
import { htmlToText } from '../imap/ImapService'
import type { DraftMessage, OutgoingAttachment, OutgoingMessage } from '../models'

export interface SignatureForSend {
  html: string
  images: { cid: string; mime: string; data: Buffer }[]
}

const FONT = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;"

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Testo semplice → HTML: righe, paragrafi e link cliccabili. */
export function textToEmailHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1a56db;">$1</a>')
    .replace(/\r?\n/g, '<br>')
}

export function buildOutgoing(d: DraftMessage, signature: SignatureForSend | null): OutgoingMessage {
  const parts: string[] = [`<div style="${FONT}">${textToEmailHtml(d.body.replace(/\s+$/, ''))}</div>`]
  const textParts: string[] = [d.body.replace(/\s+$/, '')]

  if (signature) {
    parts.push(`<br><div class="nimbus-signature">${signature.html}</div>`)
    textParts.push(`-- \n${htmlToText(signature.html).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()}`)
  }

  if (d.quoted) {
    parts.push(
      `<br><div style="${FONT}color:#555555;">${escapeHtml(d.quoted.header)}</div>` +
        `<blockquote style="margin:4px 0 0 4px;padding:0 0 0 10px;border-left:2px solid #cccccc;${FONT}color:#555555;">` +
        `${textToEmailHtml(d.quoted.text)}</blockquote>`
    )
    textParts.push(`${d.quoted.header}\n${d.quoted.text.split('\n').map((l) => `> ${l}`).join('\n')}`)
  }

  const attachments: OutgoingAttachment[] = (signature?.images ?? []).map((img, i) => ({
    filename: `firma-${i + 1}.${img.mime.split('/')[1] ?? 'png'}`,
    contentType: img.mime,
    contentBase64: img.data.toString('base64'),
    cid: img.cid
  }))

  return {
    accountId: d.accountId,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    text: textParts.join('\n\n'),
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">${parts.join('')}</body></html>`,
    inReplyTo: d.inReplyTo,
    references: d.references,
    attachments
  }
}
