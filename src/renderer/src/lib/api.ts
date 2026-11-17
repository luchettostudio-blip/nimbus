/**
 * Client IPC tipizzato: trasforma i risultati `{ok, data|error}` in Promise
 * che si risolvono o rigettano con un `IpcError` leggibile.
 */
import type { EventChannel, InvokeChannel, IpcEventMap, IpcInvokeMap } from '@shared/ipc'

export class IpcError extends Error {
  constructor(
    message: string,
    /** Titolo breve (es. "Password errata"), presente per gli errori di configurazione. */
    public readonly title?: string,
    /** Quale server ha fallito, se noto. */
    public readonly stage?: 'imap' | 'smtp'
  ) {
    super(message)
  }
}

export async function call<C extends InvokeChannel>(channel: C, ...args: IpcInvokeMap[C]['args']): Promise<IpcInvokeMap[C]['ret']> {
  const res = await window.api.invoke(channel, ...args)
  if (!res.ok) throw new IpcError(res.error, res.title, res.stage)
  return res.data
}

export function subscribe<C extends EventChannel>(channel: C, listener: (p: IpcEventMap[C]) => void): () => void {
  return window.api.on(channel, listener)
}
