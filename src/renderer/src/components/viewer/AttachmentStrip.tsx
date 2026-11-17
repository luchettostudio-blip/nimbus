import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AttachmentInfo } from '@core/models'
import { loadAttachment, previewKind } from '../../lib/attachments'
import { formatBytes } from '../../lib/format'
import { useStore } from '../../store'

const THUMB_MAX_BYTES = 8 * 1024 * 1024

/** Allegati del messaggio: miniature per le immagini, scheda per gli altri. Clic = anteprima. */
export function AttachmentStrip({ accountId, folder, uid, attachments }: { accountId: string; folder: string; uid: number; attachments: AttachmentInfo[] }) {
  const open = useStore((s) => s.openViewer)
  if (attachments.length === 0) return null
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <button
          key={a.index}
          onClick={() => open({ accountId, folder, uid, attachments, index: a.index })}
          className="group overflow-hidden rounded-xl border border-line bg-surface-2 text-left transition hover:border-accent/40 hover:bg-hover"
          title={`${a.filename} · ${formatBytes(a.size)}`}
        >
          {previewKind(a) === 'image' && a.size <= THUMB_MAX_BYTES ? (
            <Thumb accountId={accountId} folder={folder} uid={uid} info={a} />
          ) : null}
          <div className="flex max-w-[220px] items-center gap-2 px-3 py-2 text-[12px]">
            {previewKind(a) === 'image' ? (
              <ImageIcon size={13} className="shrink-0 text-muted" />
            ) : previewKind(a) === 'pdf' || previewKind(a) === 'text' ? (
              <FileText size={13} className="shrink-0 text-muted" />
            ) : (
              <Paperclip size={13} className="shrink-0 text-muted" />
            )}
            <span className="truncate">{a.filename}</span>
            <span className="shrink-0 text-faint">{formatBytes(a.size)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function Thumb({ accountId, folder, uid, info }: { accountId: string; folder: string; uid: number; info: AttachmentInfo }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    loadAttachment(accountId, folder, uid, info).then(
      (l) => alive && setUrl(l.url ?? null),
      () => alive && setFailed(true)
    )
    return () => {
      alive = false
    }
  }, [accountId, folder, uid, info])
  if (failed) return null
  return (
    <div className="flex h-28 w-[220px] items-center justify-center overflow-hidden bg-black/20">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" onError={() => setFailed(true)} />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-2" />
      )}
    </div>
  )
}
