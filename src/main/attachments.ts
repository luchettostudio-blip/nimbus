/**
 * Allegati lato main: lettura dalla cache, "Apri con app predefinita" e "Salva".
 * I file eseguibili non vengono mai aperti direttamente (solo salvati).
 */
import { dialog, shell, type BrowserWindow } from 'electron'
import { copyFile, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { CachedAttachment } from '../core/features/attachments/AttachmentCache'

/** Estensioni che Windows eseguirebbe: aprirle da una mail è il classico vettore di malware. */
const DANGEROUS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.msi', '.msp', '.scr', '.pif', '.cpl', '.lnk', '.url', '.hta', '.js', '.jse',
  '.vbs', '.vbe', '.wsf', '.wsh', '.ps1', '.psm1', '.reg', '.jar', '.dll', '.sys', '.application', '.gadget',
  '.msc', '.iso', '.img', '.vhd', '.vhdx', '.appx', '.appxbundle', '.msix', '.chm', '.scf', '.inf', '.sct'
])

export function isDangerous(filename: string): boolean {
  return DANGEROUS.has(extname(filename).toLowerCase())
}

export async function readAttachment(a: CachedAttachment) {
  const data = await readFile(a.path)
  return { data: new Uint8Array(data), mime: a.mime, filename: a.filename, size: a.size }
}

export async function openAttachment(a: CachedAttachment): Promise<void> {
  if (isDangerous(a.filename)) {
    throw new Error('Per sicurezza i file eseguibili non si aprono da qui: salvali e controllali prima.')
  }
  const err = await shell.openPath(a.path)
  if (err) throw new Error(`Nessuna app per aprire questo file (${err}).`)
}

export async function saveAttachment(a: CachedAttachment, win: BrowserWindow | null): Promise<boolean> {
  const opts = { defaultPath: a.filename, title: 'Salva allegato' }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return false
  await copyFile(a.path, res.filePath)
  return true
}
