import { useEffect } from 'react'
import { useStore } from '../store'

/**
 * Scorciatoie globali (stile Superhuman / Gmail):
 *   Ctrl+K palette · j/k giù/su · e archivia · # / Canc elimina · r rispondi
 *   a rispondi a tutti · f inoltra · c componi · u letto/non letto · s speciale
 *   / cerca · g i vai a Inbox · g a inbox unificata · Ctrl+0…9 cambio account
 *   Esc chiudi/deseleziona
 */
export function useHotkeys(): void {
  useEffect(() => {
    let gPending = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()

      // L'anteprima allegati gestisce da sola i suoi tasti.
      if (s.viewer) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        s.openSettings()
        return
      }

      // Ctrl+0 inbox unificata, Ctrl+1…9 account: cambio rapido.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[0-9]$/.test(e.key) && !s.compose && !s.showOnboarding) {
        e.preventDefault()
        s.setPalette(false)
        s.quickSwitch(Number(e.key))
        return
      }

      // Con un modale aperto o il focus in un campo, i tasti singoli non fanno nulla.
      const target = e.target as HTMLElement
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (typing || s.paletteOpen || s.compose || s.showOnboarding || s.settingsOpen) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (gPending) {
        gPending = false
        if (e.key === 'a') {
          void s.selectUnified()
        } else if (e.key === 'i') {
          const inbox = s.folders.find((f) => f.role === 'inbox')
          if (inbox) void s.selectFolder(inbox.path)
        } else if (e.key === 's') {
          const sent = s.folders.find((f) => f.role === 'sent')
          if (sent) void s.selectFolder(sent.path)
        }
        return
      }

      const handlers: Record<string, () => void> = {
        j: () => s.moveSelection(1),
        ArrowDown: () => s.moveSelection(1),
        k: () => s.moveSelection(-1),
        ArrowUp: () => s.moveSelection(-1),
        e: () => void s.archive(),
        '#': () => void s.trash(),
        Delete: () => void s.trash(),
        r: () => s.openCompose('reply'),
        a: () => s.openCompose('replyAll'),
        f: () => s.openCompose('forward'),
        c: () => s.openCompose('new'),
        u: () => void s.toggleSeen(),
        s: () => void s.toggleFlagged(),
        h: () => s.setSnoozeMenu(true),
        '/': () => s.setPalette(true),
        Escape: () => (s.searchResults ? void s.search('') : void s.selectMessage(null)),
        g: () => {
          gPending = true
          if (gTimer) clearTimeout(gTimer)
          gTimer = setTimeout(() => (gPending = false), 1000)
        }
      }
      const h = handlers[e.key]
      if (h) {
        e.preventDefault()
        h()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
