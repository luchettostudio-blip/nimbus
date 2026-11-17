import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SignaturePrefs, SignatureView } from '@core/models'
import { call } from '../../lib/api'
import { editorToStored, toEmailCompatible } from '../../lib/signatureHtml'
import { useStore } from '../../store'
import { SignaturePreview } from '../SignaturePreview'
import { SignatureEditor } from './SignatureEditor'

const STARTER = toEmailCompatible(
  '<div style="margin:0"><b>Nome Cognome</b></div><div style="margin:0;color:#666666">Ruolo · Azienda</div><div style="margin:0"><a href="tel:+39000000000">+39 000 000 0000</a></div>'
)

/** Impostazioni > Firme: più firme per account, predefinite per nuove mail e risposte. */
export function SignaturesSection() {
  const accounts = useStore((s) => s.accounts)
  const currentAccount = useStore((s) => s.accountId)
  const reloadSignatures = useStore((s) => s.loadSignatures)
  const [accountId, setAccountId] = useState(currentAccount ?? accounts[0]?.id ?? '')
  const [list, setList] = useState<SignatureView[]>([])
  const [prefs, setPrefs] = useState<SignaturePrefs>({ newId: null, replyId: null })
  const [editing, setEditing] = useState<{ id?: string; name: string; html: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (id = accountId) => {
    const [sigs, p] = await Promise.all([call('signatures:list', id), call('signatures:getPrefs', id)])
    setList(sigs)
    setPrefs(p)
    return sigs
  }

  useEffect(() => {
    if (!accountId) return
    void load(accountId).then((sigs) => {
      const first = sigs[0]
      setEditing(first ? { id: first.id, name: first.name, html: first.previewHtml } : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const html = toEmailCompatible(editorToStored(editing.html))
      const sig = await call('signatures:save', { id: editing.id, accountId, name: editing.name, html })
      setEditing({ id: sig.id, name: sig.name, html: sig.previewHtml })
      await load()
      await reloadSignatures(accountId)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    await call('signatures:delete', id)
    const sigs = await load()
    await reloadSignatures(accountId)
    setEditing(sigs[0] ? { id: sigs[0].id, name: sigs[0].name, html: sigs[0].previewHtml } : null)
  }

  const updatePrefs = async (patch: Partial<SignaturePrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    await call('signatures:setPrefs', accountId, next)
    await reloadSignatures(accountId)
  }

  const previewHtml = editing ? toEmailCompatible(editing.html) : ''
  const select = 'h-8 rounded-lg border border-line bg-surface-2 px-2 text-[12.5px] outline-none'

  return (
    <div>
      <h2 className="text-[17px] font-semibold">Firme</h2>
      <p className="mb-5 mt-1 text-[12.5px] text-muted">
        Le immagini vengono incorporate nel messaggio (non come link), ridotte a 300px e compresse.
      </p>

      {accounts.length > 1 && (
        <select className={`${select} mb-4 w-full`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3">
        <label className="text-[12px] text-muted">
          Nuove mail
          <select className={`${select} mt-1 w-full`} value={prefs.newId ?? ''} onChange={(e) => updatePrefs({ newId: e.target.value || null })}>
            <option value="">Nessuna firma</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-muted">
          Risposte e inoltri
          <select className={`${select} mt-1 w-full`} value={prefs.replyId ?? ''} onChange={(e) => updatePrefs({ replyId: e.target.value || null })}>
            <option value="">Nessuna firma</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => setEditing({ id: s.id, name: s.name, html: s.previewHtml })}
            className={`rounded-full border px-3 py-1 text-[12px] transition ${
              editing?.id === s.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:bg-hover'
            }`}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={() => setEditing({ name: list.length ? `Firma ${list.length + 1}` : 'Firma principale', html: STARTER })}
          className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-[12px] text-muted hover:bg-hover"
        >
          <Plus size={12} /> Nuova firma
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] outline-none focus:border-accent/60"
            placeholder="Nome della firma"
          />
          <SignatureEditor value={editing.html} onChange={(html) => setEditing((e) => (e ? { ...e, html } : e))} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-faint">Anteprima · chiaro</div>
              <SignaturePreview html={previewHtml} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-faint">Anteprima · scuro</div>
              <SignaturePreview html={previewHtml} dark />
            </div>
          </div>

          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-strong disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saved ? 'Salvata' : 'Salva firma'}
            </button>
            {editing.id && (
              <button onClick={() => remove(editing.id!)} className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted hover:bg-hover hover:text-danger">
                <Trash2 size={14} /> Elimina
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-6 text-center text-[13px] text-muted">Nessuna firma per questo account.</div>
      )}
    </div>
  )
}
