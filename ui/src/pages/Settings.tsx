import { useRef, useState, useEffect } from 'react'
import { api, Settings as SettingsData, SettingsInput } from '../api'

function LogoUploader() {
  const [hasLogo, setHasLogo] = useState<boolean | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true); setUploaded(false)
    const fd = new FormData(); fd.append('file', file)
    await fetch('/api/logo', { method: 'POST', credentials: 'include', body: fd })
    setHasLogo(true); setUploading(false); setUploaded(true)
    setTimeout(() => setUploaded(false), 3000)
  }

  return (
    <section className="bg-s1 border border-border rounded-card p-5 space-y-3">
      <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Brand Logo</h2>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-[#A07820] flex items-center justify-center font-bold text-bg overflow-hidden flex-shrink-0">
          {hasLogo === false
            ? 'KA'
            : <img src={`/api/logo?t=${Date.now()}`} className="w-full h-full object-cover"
                onLoad={() => setHasLogo(true)} onError={() => setHasLogo(false)} alt="logo" />
          }
        </div>
        <div className="flex-1">
          <p className="text-[12px] text-muted">PNG, JPG, SVG or WebP. Shown in sidebar and used as favicon.</p>
          {uploaded && <p className="text-[12px] text-green mt-1">✓ Logo updated — reload to see favicon change</p>}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="btn-accent text-[12px] disabled:opacity-40">
          {uploading ? 'Uploading…' : 'Upload Logo'}
        </button>
      </div>
    </section>
  )
}

export default function Settings() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [form, setForm] = useState<SettingsInput>({
    dry_run: true,
    live_from: '',
    current_expiry: '',
    signal_mode: 'image',
    alert_chat_id: '',
    source_channel_id: '',
    api_key_validity_days: 90,
    bot_token: '',
    cs_api_key: '',
    cs_api_secret: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [resetingExpiry, setResetingExpiry] = useState(false)
  const [expiryReset, setExpiryReset] = useState(false)

  useEffect(() => {
    api.settings.get().then(s => {
      setData(s)
      setForm({
        dry_run: s.dry_run,
        live_from: s.live_from ?? '',
        current_expiry: s.current_expiry,
        signal_mode: s.signal_mode,
        alert_chat_id: s.alert_chat_id,
        source_channel_id: s.source_channel_id,
        api_key_validity_days: s.api_key_validity_days ?? 90,
        bot_token: '',
        cs_api_key: '',
        cs_api_secret: '',
      })
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
            <div className="font-semibold text-sm">Live From</div>
            <div className="text-muted text-[12px] mt-0.5">Bot won't place real orders before this date even if Dry Run is off.</div>
          </div>
          <input
            type="date"
            className="input w-40"
            value={form.live_from}
            onChange={e => setForm(f => ({ ...f, live_from: e.target.value }))}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Current Expiry</div>
            <div className="text-muted text-[12px] mt-0.5">Starting expiry for signal filtering. Bot auto-updates this when signals for a new expiry arrive.</div>
          </div>
          <input
            type="date"
            className="input w-40"
            value={form.current_expiry}
            onChange={e => setForm(f => ({ ...f, current_expiry: e.target.value }))}
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

      {/* Telegram */}
      <section className="bg-s1 border border-border rounded-card p-5 space-y-3">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest">Telegram</h2>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">Source Channel ID <span className="font-normal text-muted">(where signals come from)</span></label>
          <input className="input font-mono text-xs" value={form.source_channel_id} onChange={e => setForm(f => ({ ...f, source_channel_id: e.target.value }))} placeholder="e.g. -100xxxxxxxxxx" />
        </div>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">Alert Channel ID <span className="font-normal text-muted">(where bot sends alerts)</span></label>
          <input className="input font-mono text-xs" value={form.alert_chat_id} onChange={e => setForm(f => ({ ...f, alert_chat_id: e.target.value }))} />
        </div>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">Bot Token <span className="font-normal">(leave blank to keep current)</span></label>
          <input className="input font-mono text-xs" type="password" value={form.bot_token} onChange={e => setForm(f => ({ ...f, bot_token: e.target.value }))} placeholder="(unchanged)" />
        </div>
      </section>

      {/* Master API */}
      <section className="bg-s1 border border-border rounded-card p-5 space-y-3">
        <h2 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Master API Configuration</h2>
        <p className="text-muted text-[12px]">Credentials for the master account. Child accounts with their own key use it directly; others fall back to these.</p>

        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">API Key <span className="font-normal">(leave blank to keep current)</span></label>
          <input className="input font-mono text-xs" type="password" value={form.cs_api_key} onChange={e => setForm(f => ({ ...f, cs_api_key: e.target.value }))} placeholder={data.api_key_set ? '(unchanged)' : 'Enter CoinSwitch API key'} />
        </div>
        <div>
          <label className="text-[11px] text-muted font-semibold block mb-1">API Secret <span className="font-normal">(leave blank to keep current)</span></label>
          <input className="input font-mono text-xs" type="password" value={form.cs_api_secret} onChange={e => setForm(f => ({ ...f, cs_api_secret: e.target.value }))} placeholder={data.api_key_set ? '(unchanged)' : 'Enter CoinSwitch API secret'} />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <label className="text-[11px] text-muted font-semibold whitespace-nowrap">Key Validity (days)</label>
          <input
            className="input font-mono text-xs w-24"
            type="number"
            min="1"
            value={form.api_key_validity_days}
            onChange={e => setForm(f => ({ ...f, api_key_validity_days: parseInt(e.target.value) || 90 }))}
          />
          <p className="text-[11px] text-muted flex-1">How long the broker's keys stay valid. Expiry is recomputed automatically when this changes or when new keys are saved.</p>
        </div>

        <div className="flex items-center gap-2 text-[12px] pt-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${data.api_key_set ? 'bg-green' : 'bg-red'}`} />
          <span className={data.api_key_set ? 'text-green' : 'text-red'}>
            {data.api_key_set ? 'API key configured' : 'No API key set'}
          </span>
          {data.api_key_set && data.master_days_until_expiry != null && (
            <span className={`font-mono ml-auto ${data.master_days_until_expiry <= 10 ? 'text-red' : data.master_days_until_expiry <= 30 ? 'text-amber-400' : 'text-green'}`}>
              {data.master_days_until_expiry <= 0 ? '⚠ Expired' : `${data.master_days_until_expiry}d until expiry`}
            </span>
          )}
          {data.api_key_set && data.master_days_until_expiry == null && (
            <span className="text-muted font-mono ml-auto">No key update recorded — save new keys to start tracking</span>
          )}
        </div>

        {data.api_key_set && (
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-muted flex-1">If you physically renewed the key but didn't change it here, reset the counter manually. Telegram alert fires 1 day before expiry.</p>
            <button
              onClick={async () => {
                setResetingExpiry(true); setExpiryReset(false)
                try {
                  const r = await fetch('/api/settings/reset-expiry', { method: 'POST', credentials: 'include' })
                  const j = await r.json()
                  setData(d => d ? { ...d, api_key_expires: j.expiry, master_days_until_expiry: j.days_until_expiry } : d)
                  setExpiryReset(true)
                } finally { setResetingExpiry(false) }
              }}
              disabled={resetingExpiry}
              className="text-[11px] px-3 py-1.5 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {resetingExpiry ? '…' : expiryReset ? '✓ Counter Reset' : 'Key Renewed — Reset Counter'}
            </button>
          </div>
        )}
      </section>

      {/* Logo */}
      <LogoUploader />

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
