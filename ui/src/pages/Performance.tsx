import { useEffect, useRef, useState, useCallback } from 'react'
import { api, GainEntry, GainEntryInput, GainsData, CurrentExpiryGain } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(n: number, forcePlus = false) {
  const sign = n >= 0 ? (forcePlus ? '+' : '') : '−'
  return `${sign}${Math.abs(n).toFixed(2)}%`
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function monthLabel(iso: string) {
  return new Date(iso + 'T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function pctClass(n: number) {
  return n > 0 ? 'text-green' : n < 0 ? 'text-red' : 'text-muted'
}

// ── Canvas sparkline ──────────────────────────────────────────────────────────

function Sparkline({ entries }: { entries: GainEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    const H   = 72
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const all = entries.filter(e => e.type !== 'break')
    if (!all.length) return

    const n   = all.length
    const gap = 3
    const bw  = Math.max(4, Math.floor((W - gap * (n - 1)) / n))
    const tot = bw * n + gap * (n - 1)
    const offX = (W - tot) / 2
    const midY = H / 2
    const scl  = (midY - 8) / 6  // 6% = full half

    ctx.strokeStyle = 'rgba(255,220,130,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke()

    all.forEach((e, i) => {
      const x   = offX + i * (bw + gap)
      const h   = Math.abs(e.gain_pct) * scl
      const pos = e.gain_pct >= 0
      ctx.fillStyle = pos ? 'rgba(91,190,114,0.82)' : 'rgba(212,88,88,0.82)'
      if (pos) ctx.fillRect(x, midY - h, bw, h || 1)
      else     ctx.fillRect(x, midY,     bw, h || 1)
    })
  }, [entries])

  return (
    <canvas ref={canvasRef} style={{ width: '100%', display: 'block', height: 72 }} height={72} />
  )
}

// ── Share image ───────────────────────────────────────────────────────────────

function drawShareCard(
  canvas: HTMLCanvasElement,
  entries: GainEntry[],
  stats: GainsData['stats'],
  current: CurrentExpiryGain | null,
  size: number,
) {
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const s   = size / 540

  ctx.fillStyle = '#0A0806'
  ctx.fillRect(0, 0, size, size)

  const grad = ctx.createLinearGradient(0, 0, size * 0.55, 0)
  grad.addColorStop(0,   '#C9A23C')
  grad.addColorStop(0.6, 'rgba(201,162,60,0.2)')
  grad.addColorStop(1,   'transparent')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, 3 * s)

  ctx.font      = `700 ${24 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#EDE4D2'
  ctx.fillText('Kirasha', 56 * s, 80 * s)
  const bw = ctx.measureText('Kirasha').width
  ctx.fillStyle = '#C9A23C'
  ctx.fillText(' BTC Algo', 56 * s + bw, 80 * s)
  ctx.font      = `400 ${11 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#4A3422'
  ctx.fillText('BTC Options — Weekly Performance', 56 * s, 100 * s)

  const divider = (y: number) => {
    ctx.strokeStyle = 'rgba(255,220,130,0.07)'
    ctx.lineWidth   = 1 * s
    ctx.beginPath(); ctx.moveTo(56 * s, y * s); ctx.lineTo(size - 56 * s, y * s); ctx.stroke()
  }
  divider(116)

  const atg = stats.all_time_gain_pct
  ctx.font      = `500 ${11 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#7A6250'
  ctx.fillText('ALL-TIME', 56 * s, 150 * s)
  ctx.font      = `700 ${56 * s}px 'JetBrains Mono', monospace`
  ctx.fillStyle = atg >= 0 ? '#5BBE72' : '#D45858'
  ctx.fillText((atg >= 0 ? '+' : '−') + Math.abs(atg).toFixed(1) + '%', 56 * s, 218 * s)

  divider(234)

  const lX = 56 * s, rX = 300 * s
  const curGain = current?.gain_pct ?? 0
  const curDate = current?.expiry_iso ? fmtDate(current.expiry_iso) : '—'
  const lgGain  = stats.launch_gain_pct

  ctx.font      = `500 ${10 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#7A6250'
  ctx.fillText('CURRENT EXPIRY', lX, 268 * s)
  ctx.font      = `700 ${34 * s}px 'JetBrains Mono', monospace`
  ctx.fillStyle = curGain >= 0 ? '#5BBE72' : '#D45858'
  ctx.fillText((curGain >= 0 ? '+' : '−') + Math.abs(curGain).toFixed(2) + '%', lX, 306 * s)
  ctx.font      = `400 ${10 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#4A3422'
  ctx.fillText(curDate, lX, 322 * s)

  ctx.font      = `500 ${10 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#7A6250'
  ctx.fillText('SINCE SEP 2', rX, 268 * s)
  ctx.font      = `700 ${34 * s}px 'JetBrains Mono', monospace`
  ctx.fillStyle = lgGain >= 0 ? '#5BBE72' : '#D45858'
  ctx.fillText((lgGain >= 0 ? '+' : '−') + Math.abs(lgGain).toFixed(2) + '%', rX, 306 * s)
  ctx.font      = `400 ${10 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#4A3422'
  ctx.fillText(`From ${fmtDate('2026-08-28')}`, rX, 322 * s)

  ctx.strokeStyle = 'rgba(255,220,130,0.07)'
  ctx.lineWidth   = 1 * s
  ctx.beginPath(); ctx.moveTo(280 * s, 248 * s); ctx.lineTo(280 * s, 336 * s); ctx.stroke()

  divider(370)

  const statRow = [
    { lbl: 'WIN RATE', val: stats.win_rate.toFixed(0) + '%', col: '#EDE4D2' },
    { lbl: 'WEEKS',    val: String(stats.total_weeks),        col: '#EDE4D2' },
  ]
  const colW = (size - 112 * s) / 2
  statRow.forEach((r, i) => {
    const rx = 56 * s + i * colW
    ctx.font      = `500 ${9 * s}px 'Space Grotesk', sans-serif`
    ctx.fillStyle = '#4A3422'
    ctx.fillText(r.lbl, rx, 400 * s)
    ctx.font      = `600 ${22 * s}px 'JetBrains Mono', monospace`
    ctx.fillStyle = r.col
    ctx.fillText(r.val, rx, 426 * s)
  })

  ctx.font      = `400 ${9 * s}px 'Space Grotesk', sans-serif`
  ctx.fillStyle = '#2A1E12'
  ctx.fillText('Kirasha BTC Algo · Weekly Performance', 56 * s, 490 * s)
  ctx.fillStyle = '#C9A23C'
  const foot = 'kirasha.in'
  ctx.fillText(foot, size - 56 * s - ctx.measureText(foot).width, 490 * s)
}

// ── Add Expiry Modal ──────────────────────────────────────────────────────────

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [expiry, setExpiry] = useState('')
  const [pct,    setPct]    = useState('')
  const [type,   setType]   = useState<'algo' | 'manual' | 'break'>('algo')
  const [note,   setNote]   = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!expiry) { setErr('Expiry date required'); return }
    if (type !== 'break' && pct === '') { setErr('Gain % required'); return }
    setSaving(true); setErr('')
    try {
      const entry: GainEntryInput = {
        expiry,
        gain_pct: type === 'break' ? 0 : parseFloat(pct),
        type,
        note: note || undefined,
      }
      await api.gains.add(entry)
      onAdded(); onClose()
    } catch (ex: any) {
      setErr(ex.message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-s1 border border-border rounded-card p-6 w-full max-w-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-tx">Add Expiry Result</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Expiry Date</label>
              <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="input" required />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Gain %</label>
              <input
                type="number" step="0.01" value={pct}
                onChange={e => setPct(e.target.value)}
                placeholder="e.g. 1.5 or −3.2"
                disabled={type === 'break'}
                className="input disabled:opacity-40"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Type</label>
            <select value={type} onChange={e => setType(e.target.value as any)} className="input">
              <option value="algo">Algo (automated)</option>
              <option value="manual">Manual</option>
              <option value="break">Break — no trade this week</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-muted mb-1.5">Note (optional)</label>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Telegram outage, market holiday…"
              className="input"
            />
          </div>
          {err && <p className="text-xs text-red">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
            <button type="submit" disabled={saving} className="btn-accent text-xs px-4 py-1.5">
              {saving ? 'Saving…' : 'Add Result'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Share Modal ───────────────────────────────────────────────────────────────

function ShareModal({
  entries, stats, current, onClose,
}: {
  entries: GainEntry[]
  stats:   GainsData['stats']
  current: CurrentExpiryGain | null
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    document.fonts.ready.then(() => drawShareCard(canvas, entries, stats, current, 540))
  }, [entries, stats, current])

  function download() {
    const tmp   = document.createElement('canvas')
    const today = new Date().toISOString().slice(0, 10)
    document.fonts.ready.then(() => {
      drawShareCard(tmp, entries, stats, current, 1080)
      const a = document.createElement('a')
      a.download = `kirafx-performance-${today}.png`
      a.href = tmp.toDataURL('image/png')
      a.click()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-s1 border border-border rounded-card p-6 w-full max-w-lg shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-tx">Share Weekly Performance</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">×</button>
        </div>
        <div className="rounded-lg overflow-hidden border border-border aspect-square">
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
        <p className="text-[11px] text-muted font-mono">
          All-time · Current expiry · Since Sep 2 — exports 1080×1080 PNG
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">Close</button>
          <button onClick={download} className="btn-accent text-xs px-4 py-1.5">↓ Download 1080×1080</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const LAUNCH = '2026-08-28'

export default function Performance() {
  const [data,      setData]      = useState<GainsData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [view,      setView]      = useState<'all' | 'launch'>('all')

  const load = useCallback(async () => {
    try { setData(await api.gains.get()) } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  if (loading) {
    return (
      <div className="p-6 text-muted text-sm flex items-center gap-2">
        <span className="animate-spin inline-block text-accent">⟳</span> Loading performance…
      </div>
    )
  }
  if (!data) return <div className="p-6 text-sm text-red">Failed to load gains data.</div>

  const { entries, stats, current_expiry: cur } = data
  const reversed = [...entries].reverse()

  // Build per-entry compound values for the cumulative column
  let allRun    = 1.0
  let launchRun = 1.0
  const cmap: Record<string, { all: number; launch: number | null }> = {}
  for (const e of entries) {
    if (e.type !== 'break') {
      allRun *= (1 + e.gain_pct / 100)
      if (e.expiry >= LAUNCH) launchRun *= (1 + e.gain_pct / 100)
    }
    cmap[e.expiry] = {
      all:    +((allRun - 1) * 100).toFixed(2),
      launch: e.expiry >= LAUNCH ? +((launchRun - 1) * 100).toFixed(2) : null,
    }
  }

  return (
    <div className="p-5 space-y-4 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Weekly Performance — BTC Options
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="btn-ghost text-xs flex items-center gap-1.5"
            style={{ color: '#5BBE72', borderColor: 'rgba(91,190,114,0.25)' }}
          >
            <span className="text-base leading-none">+</span> Add Expiry
          </button>
          <button
            onClick={() => setShowShare(true)}
            className="btn-ghost text-xs flex items-center gap-1.5"
            style={{ color: '#C9A23C', borderColor: 'rgba(201,162,60,0.25)' }}
          >
            ↑ Share Image
          </button>
        </div>
      </div>

      {/* Launch notice */}
      <div
        className="flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-[12px] leading-snug"
        style={{ background: 'rgba(201,162,60,0.06)', border: '1px solid rgba(201,162,60,0.15)', color: '#C9A23C' }}
      >
        <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.2">
          <circle cx="7" cy="7" r="6"/><path d="M7 4.5v3l1.5 1" strokeLinecap="round"/>
        </svg>
        <span>
          <strong>Product launch: Sep 2, 2026.</strong> "Since Sep 2" metric uses the{' '}
          <strong>Aug 28</strong> expiry as anchor — first algo cycle counts toward launch performance.
        </span>
      </div>

      {/* 3 stat cards */}
      <div className="grid grid-cols-3 gap-3">

        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2.5">All-time Gain</div>
          <div className={`font-mono text-3xl font-bold leading-none ${pctClass(stats.all_time_gain_pct)}`}>
            {fmtPct(stats.all_time_gain_pct, true)}
          </div>
          <div className="text-[11px] text-muted mt-2 font-mono">
            {stats.wins}W · {stats.losses}L · {stats.total_weeks} weeks · compound
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] uppercase tracking-widest text-muted">Current Expiry</span>
            {cur?.is_live && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-live">
                <span className="w-1.5 h-1.5 rounded-full bg-green-live inline-block" />
                Live
              </span>
            )}
          </div>
          {cur && !cur.error ? (
            <>
              <div className={`font-mono text-3xl font-bold leading-none ${pctClass(cur.gain_pct)}`}>
                {fmtPct(cur.gain_pct, true)}
              </div>
              <div className="text-[11px] text-muted mt-2 font-mono space-y-0.5">
                <div>
                  {cur.expiry} &nbsp;·&nbsp;
                  <span className={cur.total_pnl >= 0 ? 'text-green' : 'text-red'}>
                    {cur.total_pnl >= 0 ? '+' : '−'}${Math.abs(cur.total_pnl).toFixed(2)}
                  </span>
                </div>
                <div className="text-[10px]">
                  R: ${cur.realized_pnl.toFixed(2)} · U: ${cur.unrealized_pnl.toFixed(2)}
                </div>
              </div>
            </>
          ) : (
            <div className="font-mono text-2xl font-bold text-muted">—</div>
          )}
        </div>

        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2.5">Since Sep 2 Launch</div>
          {stats.launch_gain_pct !== 0 ? (
            <>
              <div className={`font-mono text-3xl font-bold leading-none ${pctClass(stats.launch_gain_pct)}`}>
                {fmtPct(stats.launch_gain_pct, true)}
              </div>
              <div className="text-[11px] text-muted mt-2 font-mono">
                ${stats.initial_balance} → ${stats.current_balance_est.toFixed(0)} USDT est.
              </div>
            </>
          ) : (
            <>
              <div className="font-mono text-2xl font-bold text-accent">Pending</div>
              <div className="text-[11px] text-muted mt-2 font-mono">First expiry: Aug 28 '26</div>
            </>
          )}
        </div>
      </div>

      {/* Sparkline */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-widest text-muted">
            Gain per expiry — {entries.filter(e => e.type !== 'break').length} completed weeks
          </span>
          <span className="text-[11px] text-muted font-mono">
            {entries[0] ? fmtDate(entries[0].expiry) : ''} → {entries[entries.length - 1] ? fmtDate(entries[entries.length - 1].expiry) : ''}
          </span>
        </div>
        <Sparkline entries={entries} />
      </div>

      {/* Weekly table */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[10px] uppercase tracking-widest text-muted">
            Weekly Results ({entries.length})
          </span>
          <div className="flex bg-bg rounded-lg p-0.5 gap-0.5">
            {(['all', 'launch'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={[
                  'text-[11px] font-semibold px-3 py-1 rounded-md transition-colors',
                  view === v ? 'bg-s2 text-tx' : 'text-muted hover:text-tx',
                ].join(' ')}
              >
                {v === 'all' ? 'All-time' : 'Since Sep 2'}
              </button>
            ))}
          </div>
        </div>

        {view === 'launch' && reversed.filter(e => e.expiry >= LAUNCH).length === 0 ? (
          <div className="px-4 py-10 text-center text-muted text-sm space-y-1">
            <div className="text-2xl mb-3">⏳</div>
            <div className="font-semibold text-tx">No algo entries yet</div>
            <div className="text-[12px]">First expiry: <span className="text-accent font-mono">28 Aug '26</span> — results will appear here automatically after settlement.</div>
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] uppercase tracking-widest text-muted px-4 py-2.5 font-medium">Expiry</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-muted px-4 py-2.5 font-medium">Week Gain</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-muted px-4 py-2.5 font-medium">
                  {view === 'all' ? 'Cumulative' : 'Since Sep 2'}
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-muted px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 w-24" />
              </tr>
            </thead>
            <tbody>
              {(view === 'launch' ? reversed.filter(e => e.expiry >= LAUNCH) : reversed).flatMap((e, ri, arr) => {
                const rows: React.ReactNode[] = []
                const ym = e.expiry.slice(0, 7)

                if (ym !== (arr[ri - 1]?.expiry.slice(0, 7) ?? '')) {
                  rows.push(
                    <tr key={`div-${ym}`} className="bg-s2/30">
                      <td colSpan={5} className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted2">
                        {monthLabel(e.expiry)}
                      </td>
                    </tr>
                  )
                }

                const cum     = view === 'all' ? cmap[e.expiry]?.all : cmap[e.expiry]?.launch
                const isBreak = e.type === 'break'
                const barW    = Math.round(Math.abs(e.gain_pct) / 5.6 * 56)

                rows.push(
                  <tr
                    key={e.expiry}
                    className={`border-b border-border hover:bg-s2/50 transition-colors ${isBreak ? 'opacity-40' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-tx font-mono text-xs">
                      {fmtDate(e.expiry)}
                      {e.note && (
                        <span className="ml-2 text-[10px] text-muted font-sans font-normal">({e.note})</span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${isBreak ? 'text-muted' : pctClass(e.gain_pct)}`}>
                      {isBreak ? '—' : fmtPct(e.gain_pct, true)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${cum == null ? 'text-muted' : pctClass(cum)}`}>
                      {cum != null ? fmtPct(cum, true) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={[
                        'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border',
                        e.type === 'algo'
                          ? 'text-blue border-blue/25 bg-blue/10'
                          : e.type === 'break'
                          ? 'text-accent border-accent/25 bg-accent/10'
                          : 'text-muted border-border bg-s3',
                      ].join(' ')}>
                        {e.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {!isBreak && (
                        <div
                          className={`h-[3px] rounded-full ${e.gain_pct >= 0 ? 'bg-green' : 'bg-red'}`}
                          style={{ width: barW }}
                        />
                      )}
                    </td>
                  </tr>
                )

                return rows
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Active expiry status bar */}
      {cur && !cur.error && (
        <div className="card px-4 py-3 flex items-center gap-3" style={{ borderColor: 'rgba(201,162,60,0.2)' }}>
          <span className="w-2 h-2 rounded-full bg-green-live flex-shrink-0" />
          <span className="text-xs text-muted font-mono">
            <span className="text-tx font-semibold">{cur.expiry}</span> active.
            Live P&L: <span className={pctClass(cur.gain_pct)}>{fmtPct(cur.gain_pct, true)}</span>
            {' '}({cur.is_live ? 'positions open' : 'all flat — auto-settlement pending'})
          </span>
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onAdded={load} />}
      {showShare && (
        <ShareModal entries={entries} stats={stats} current={cur} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}
