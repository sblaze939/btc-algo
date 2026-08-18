import { useState, useEffect } from 'react'
import { api, Settings as SettingsData, SettingsInput } from '../api'

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [form, setForm] = useState<SettingsInput>({ dry_run: true, live_from: '', signal_mode: 'image', alert_chat_id: '', bot_token: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.settings.get().then(s => {
      setData(s)
      setForm({ dry_run: s.dry_run, live_from: s.live_from, signal_mode: s.signal_mode, alert_chat_id: s.alert_chat_id, bot_token: '' })
    })
  }, [])

  async function save() {
    setSaving(true); setErr(''); setSaved(false)
    try {
      await api.settings.save(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setErr(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <div className="p-6 text-muted text-sm">Loading…</div>

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-4">
      <div className="mb-2">
        <h1 className="text-[17px] font-bold">Settings</h1>
        <p className="text-muted text-[12px] mt-0.5">Restart the bot after saving for changes to take effect</p>
      </div>

      {/* Trading Mode */}
      <section className="bg-s1 border border-border rounded-card p-5 space-y-4">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Trading Mode</h2>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Dry Run</div>
            <div className="text-muted text-[12px] mt-0.5">Log signals without placing real orders</div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={form.dry_run} onChange={e => setForm(f => ({ ...f, dry_run: e.target.checked }))} />
            <div className="w-11 h-6 bg-s3 rounded-full peer-checked:bg-green transition-colors" />
            <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Live Trading From</div>
            <div className="text-muted text-[12px] mt-0.5">Extra safety gate — no orders before this date even if DRY RUN is off</div>
          </div>
          <input
            type="date"
            className="input w-40"
            value={form.live_from}
            onChange={e => setForm(f => ({ ...f, live_from: e.target.value }))}
          />
        </div>
      </section>

      {/* Signal Mode */}
      <section className="bg-s1 border border-border rounded-card p-5">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Signal Mode</h2>
        <div className="flex bg-bg border border-border rounded-lg p-0.5 gap-0.5 mb-3">
          {(['image', 'text', 'both'] as const).map(m => (
            <button
              key={m}
              onClick={() => setForm(f => ({ ...f, signal_mode: m }))}
              className={`flex-1 py-2 rounded-md text-[12px] font-semibold transition-colors capitalize ${form.signal_mode === m ? 'bg-s2 text-tx' : 'text-muted hover:text-tx'}`}
            >
              {m === 'image' ? '📷 Image' : m === 'text' ? '✏️ Text' : '⚡ Both'}
            </button>
          ))}
        </div>
        <p className="text-muted text-[12px] leading-relaxed">
          <b className="text-tx">Image</b> — Gemini Vision on every photo (default) ·{' '}
          <b className="text-tx">Text</b> — parse plain text, no Gemini call ·{' '}
          <b className="text-tx">Both</b> — image first, fall back to text
        </p>
      </section>

      {/* Telegram Alerts */}
      <section className="bg-s1 border border-border rounded-card p-5 space-y-3">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Telegram Alerts</h2>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">Alert Channel ID</label>
          <input className="input font-mono text-xs" value={form.alert_chat_id} onChange={e => setForm(f => ({ ...f, alert_chat_id: e.target.value }))} />
        </div>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">Bot Token <span className="font-normal">(leave blank to keep current)</span></label>
          <input className="input font-mono text-xs" type="password" value={form.bot_token} onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))} placeholder="(unchanged)" />
        </div>
      </section>

      {/* Master API */}
      <section className="bg-s1 border border-border rounded-card p-5">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Master API Configuration</h2>
        <p className="text-muted text-[12px] mb-3">Fallback used when an account has no personal API key. Managed via .env on the VM.</p>
        <div className="flex items-center gap-2 text-[12px]">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${data.api_key_set ? 'bg-green' : 'bg-red'}`} />
          <span className={data.api_key_set ? 'text-green' : 'text-red'}>
            {data.api_key_set ? 'API key configured' : 'No API key set'}
          </span>
          {data.api_key_set && (
            <span className="text-red font-mono ml-auto">⚠ Expires {data.api_key_expires} — regenerate before then</span>
          )}
        </div>
      </section>

      {/* Save bar */}
      <div className="flex items-center justify-end gap-3 pt-1">
        {err && <span className="text-red text-sm">{err}</span>}
        {saved && <span className="text-green text-sm">✓ Saved — restart bot to apply</span>}
        <button onClick={save} disabled={saving} className="btn-accent">
          {saving ? 'Saving…' : 'Save & Restart Bot'}
        </button>
      </div>
    </div>
  )
}
