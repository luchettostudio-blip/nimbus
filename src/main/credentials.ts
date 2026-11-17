/**
 * Credential store basato su `safeStorage` di Electron (API asincrone).
 * Su Windows usa DPAPI: le password sono cifrate con la chiave dell'utente
 * Windows corrente e salvate (solo in forma cifrata) in `credentials.json`.
 */
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { CredentialStore } from '../core/sync/SyncEngine'

export class SafeCredentialStore implements CredentialStore {
  private data: Record<string, string>

  constructor(private readonly filePath: string) {
    this.data = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : {}
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 })
  }

  async get(accountId: string): Promise<string | null> {
    const enc = this.data[accountId]
    if (!enc) return null
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))
      // La chiave di cifratura è stata ruotata: salva di nuovo con quella attuale.
      if (shouldReEncrypt) await this.set(accountId, result)
      return result
    } catch {
      return null
    }
  }

  async set(accountId: string, password: string): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Cifratura di sistema non disponibile: impossibile salvare la password in modo sicuro.')
    }
    this.data[accountId] = (await safeStorage.encryptStringAsync(password)).toString('base64')
    this.persist()
  }

  async delete(accountId: string): Promise<void> {
    delete this.data[accountId]
    this.persist()
  }
}
