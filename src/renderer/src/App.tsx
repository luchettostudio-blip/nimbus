import { AnimatePresence } from 'framer-motion'
import { useEffect } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Composer } from './components/Composer'
import { MessageList } from './components/MessageList'
import { MessageView } from './components/MessageView'
import { Onboarding } from './components/Onboarding'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { Settings } from './components/settings/Settings'
import { ScheduledView } from './components/ScheduledView'
import { SnoozedView } from './components/SnoozedView'
import { AttachmentViewer } from './components/viewer/AttachmentViewer'
import { useHotkeys } from './hooks/useHotkeys'
import { subscribe } from './lib/api'
import { useStore } from './store'

export default function App() {
  const ready = useStore((s) => s.ready)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const compose = useStore((s) => s.compose)
  const showOnboarding = useStore((s) => s.showOnboarding)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const viewKind = useStore((s) => s.view?.kind)
  const viewerOpen = useStore((s) => s.viewer !== null)

  useHotkeys()

  useEffect(() => {
    const { init, handleSyncEvent, openMessageRef } = useStore.getState()
    const offSync = subscribe('sync:event', handleSyncEvent)
    const offOpen = subscribe('app:openMessage', (ref) => void openMessageRef(ref))
    const offNav = subscribe('app:navigate', (nav) => {
      if (nav.view === 'scheduled') useStore.getState().selectScheduled()
      if (nav.view === 'snoozed') useStore.getState().selectSnoozed()
    })
    void init()
    return () => {
      offSync()
      offOpen()
      offNav()
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {ready && (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {/* Pannello principale: lista + lettura su superficie traslucida sopra il Mica. */}
          <main className="mr-2 mb-2 flex min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            {viewKind === 'scheduled' ? (
              <ScheduledView />
            ) : viewKind === 'snoozed' ? (
              <SnoozedView />
            ) : (
              <>
                <MessageList />
                <MessageView />
              </>
            )}
          </main>
        </div>
      )}

      <AnimatePresence>{compose && <Composer key="composer" />}</AnimatePresence>
      <AnimatePresence>{paletteOpen && <CommandPalette key="palette" />}</AnimatePresence>
      <AnimatePresence>{showOnboarding && <Onboarding key="onboarding" />}</AnimatePresence>
      <AnimatePresence>{settingsOpen && <Settings key="settings" />}</AnimatePresence>
      <AnimatePresence>{viewerOpen && <AttachmentViewer key="viewer" />}</AnimatePresence>
      <Toasts />
    </div>
  )
}
