/**
 * Preload: unico ponte fra renderer (sandbox, senza Node) e main process.
 * Espone solo `window.api` con canali in whitelist.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type PreloadApi } from '../shared/ipc'

const api: PreloadApi = {
  invoke: (channel, ...args) => {
    if (!INVOKE_CHANNELS.includes(channel)) return Promise.reject(new Error(`Canale non consentito: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, listener) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Canale non consentito: ${channel}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (_e: IpcRendererEvent, payload: any) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
