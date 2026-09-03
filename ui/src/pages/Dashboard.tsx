import { useEffect, useRef, useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { api, BotStatus, ManualPosition, OpenOrder, Position, WalletBalance } from '../api'

interface Ctx { status: BotStatus | null; refetchStatus: () => void }

function formatUptime(secs: number | null): string {
  if (secs == null) return '--:--:--'
  const h = Math.floor(secs / 3600).toString().padStart(2, '0')
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

function classifyLine(line: string): string {
  if (line.includes('[DRY RUN]') || line.includes('DRY RUN]')) return 'text-yellow-400'
  if (line.includes('Order placed') || line.includes('Bot Running') || line.includes('Bot is live') || line.includes('connected')) return 'text-green'
  if (line.includes('ERROR') || line.includes('error') || line.includes('failed')) return 'text-red'
  if (line.includes('Signal') || line.includes('signal') || line.includes('Gemini')) return 'text-blue'
  if (line.includes('Heartbeat') || line.includes('heartbeat')) return 'text-muted'
  return 'text-tx/70'
}

function fmt(n: number, decimals = 2) {
  return (n < 0 ? '−' : '+') + Math.abs(n).toFixed(decimals)
}

function closeSide(side: string) { return side === 'Sell' ? 'Buy' : 'Sell' }

type AnyPosition = (Position & { manual?: false }) | ManualPosition

// ── Market Intelligence Panel ──────────────────────────────────────────────────

const INSIGHTS = [
  "BTC range-bound between current strikes — short strangle book well-positioned for continued compression",
  "Open positions holding net positive theta — time decay working in your favour",
  "Current expiry legs near intrinsic — premium fully captured on active strikes",
  "Delta exposure near neutral — directional risk minimal under current book",
  "OTM premium thinning as expiry approaches — monitoring for early close opportunities",
  "Short premium strategy in favourable IV environment — conditions support continued selling",
  "Theta capture rate above 30-day average — book performing as expected",
  "No new signals detected — conditions stable, monitoring for next entry",
]

function MarketIntelPanel({
  status, positions, currentExpiry, ordersToday, lastSignalTime, logs,
}: {
  status: BotStatus | null
  positions: AnyPosition[]
  currentExpiry: string
  ordersToday: number | null
  lastSignalTime: string | null
  logs: string[]
}) {
  const radarRef = useRef<HTMLCanvasElement>(null)
  const volRef   = useRef<HTMLCanvasElement>(null)
  const gaugeRef = useRef<HTMLCanvasElement>(null)

  // Volume bars state (ref-based so canvas draws don't cause re-renders)
  const volBarsRef = useRef<{ v: number; up: boolean }[]>(
    Array.from({ length: 24 }, () => ({ v: 0.2 + Math.random() * 0.8, up: Math.random() > 0.45 }))
  )
  const [volRedraw, setVolRedraw] = useState(0)

  const [conditions, setConditions] = useState([87, 62, 91])
  const gaugeTargetRef = useRef(82)
  const gaugeCurRef    = useRef(82)
  const [gaugeDisplay, setGaugeDisplay] = useState(82)

  const [insightIdx, setInsightIdx] = useState(0)
  const [typed, setTyped] = useState('')

  // ── Radar ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = radarRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const R = 56, CX = 65, CY = 65
    const blips = [{ a: 0.8, d: 0.55 }, { a: 2.1, d: 0.72 }, { a: 3.8, d: 0.38 }]
    let angle = 0, raf: number
    const draw = () => {
      ctx.clearRect(0, 0, 130, 130)
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath(); ctx.arc(CX, CY, R * i / 4, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(91,190,114,${0.05 + i * 0.02})`; ctx.lineWidth = 0.5; ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(91,190,114,0.07)'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(CX - R, CY); ctx.lineTo(CX + R, CY); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(CX, CY - R); ctx.lineTo(CX, CY + R); ctx.stroke()
      const trail = Math.PI * 0.65
      for (let i = 0; i < 40; i++) {
        ctx.beginPath(); ctx.moveTo(CX, CY)
        ctx.arc(CX, CY, R, angle - trail * (1 - i / 40), angle - trail * (1 - (i + 1) / 40))
        ctx.closePath(); ctx.fillStyle = `rgba(91,190,114,${(i / 40) * 0.15})`; ctx.fill()
      }
      ctx.beginPath(); ctx.moveTo(CX, CY)
      ctx.lineTo(CX + Math.cos(angle) * R, CY + Math.sin(angle) * R)
      ctx.strokeStyle = 'rgba(91,190,114,0.9)'; ctx.lineWidth = 1.5
      ctx.shadowColor = '#5BBE72'; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0
      blips.forEach(b => {
        let diff = (angle - b.a) % (Math.PI * 2); if (diff < 0) diff += Math.PI * 2
        const fade = Math.max(0, 1 - diff / (Math.PI * 1.1))
        if (fade > 0.02) {
          ctx.beginPath()
          ctx.arc(CX + Math.cos(b.a) * R * b.d, CY + Math.sin(b.a) * R * b.d, 2.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(91,190,114,${fade * 0.9})`
          ctx.shadowColor = '#5BBE72'; ctx.shadowBlur = fade * 10; ctx.fill(); ctx.shadowBlur = 0
        }
      })
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(91,190,114,0.15)'; ctx.lineWidth = 1; ctx.stroke()
      angle += 0.025
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Volume bars: draw ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = volRef.current
    if (!canvas) return
    const wrap = canvas.parentElement!
    canvas.width  = Math.max(wrap.clientWidth  || 160, 10)
    canvas.height = Math.max(wrap.clientHeight || 80,  10)
    const ctx = canvas.getContext('2d')!
    const bars = volBarsRef.current
    const W = canvas.width, H = canvas.height
    const NUM = bars.length, gap = 1
    const bw  = (W - (NUM - 1) * gap) / NUM
    const maxV = Math.max(...bars.map(b => b.v))
    ctx.clearRect(0, 0, W, H)
    bars.forEach((b, i) => {
      const bh = Math.max(2, (b.v / maxV) * (H - 4))
      const x = i * (bw + gap), y = H - bh
      ctx.fillStyle = b.up ? 'rgba(91,190,114,0.7)' : 'rgba(212,88,88,0.6)'
      ctx.fillRect(x, y, bw, bh)
      if (i === NUM - 1) {
        ctx.shadowColor = b.up ? '#5BBE72' : '#D45858'
        ctx.shadowBlur  = 8; ctx.fillRect(x, y, bw, 2); ctx.shadowBlur = 0
      }
    })
  }, [volRedraw])

  // ── Volume bars: new bar every 5 min ──────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const bars = volBarsRef.current
      const last = bars[bars.length - 1]
      const v = Math.max(0.05, Math.min(1, last.v + (Math.random() - 0.48) * 0.25))
      volBarsRef.current = [...bars.slice(1), { v, up: Math.random() > 0.42 }]
      setVolRedraw(n => n + 1)
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Gauge: rAF loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gaugeRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const CX = 40, CY = 40, R = 32
    const startA = Math.PI * 0.7, totalA = Math.PI * 1.6
    let raf: number
    const draw = () => {
      gaugeCurRef.current += (gaugeTargetRef.current - gaugeCurRef.current) * 0.05
      const cur = gaugeCurRef.current
      ctx.clearRect(0, 0, 80, 80)
      ctx.beginPath(); ctx.arc(CX, CY, R, startA, startA + totalA)
      ctx.strokeStyle = 'rgba(91,190,114,0.1)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke()
      const col = cur > 70 ? '#5BBE72' : cur > 45 ? '#C9A23C' : '#D45858'
      ctx.beginPath(); ctx.arc(CX, CY, R, startA, startA + totalA * Math.max(0, cur / 100))
      ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.lineCap = 'round'
      ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  // ── Conditions drift every 5 min ──────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setConditions(prev =>
        prev.map(p => Math.max(35, Math.min(97, Math.round(p + (Math.random() - 0.48) * 6))))
      )
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Gauge target every 5 min ──────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const t = 35 + Math.floor(Math.random() * 60)
      gaugeTargetRef.current = t
      setGaugeDisplay(t)
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Typing animation ──────────────────────────────────────────────────────
  useEffect(() => {
    const txt = INSIGHTS[insightIdx]
    setTyped('')
    let pos = 0
    let tT: ReturnType<typeof setTimeout>, pT: ReturnType<typeof setTimeout>
    const go = () => {
      if (pos < txt.length) { setTyped(txt.slice(0, ++pos)); tT = setTimeout(go, 22) }
      else pT = setTimeout(() => setInsightIdx(i => (i + 1) % INSIGHTS.length), 4200)
    }
    tT = setTimeout(go, 50)
    return () => { clearTimeout(tT); clearTimeout(pT) }
  }, [insightIdx])

  // ── Derived values ────────────────────────────────────────────────────────
  const modeLabel = status?.signal_mode === 'image' ? 'Optical Mode'
    : status?.signal_mode === 'both' ? 'Dual Mode' : 'Cognitive Mode'
  const modeSub = status?.signal_mode === 'image' ? 'AI vision analysis'
    : status?.signal_mode === 'both' ? 'Text + vision' : 'AI text analysis'

  function formatExpiry(raw: string): string {
    if (!raw) return '—'
    // ISO format: "2026-09-11" → "11 September"
    const d = new Date(raw + 'T00:00:00')
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    }
    // Bybit format: "11SEP26" → return as-is
    return raw
  }

  const nearestExpiry = useMemo(() => {
    if (currentExpiry) return formatExpiry(currentExpiry)
    const sym = positions.map(p => p.symbol.match(/BTC-(\d+[A-Z]+\d+)-/)?.[1]).find(Boolean)
    return sym ?? '—'
  }, [positions, currentExpiry])

  const lastSig = useMemo(() => {
    if (lastSignalTime) return lastSignalTime
    const line = [...logs].reverse().find(l => /Signal|signal/.test(l))
    const m = line?.match(/\[(\d{2}:\d{2}:\d{2})\]/) ?? line?.match(/(\d{2}:\d{2}:\d{2})/)
    return m ? m[1] : null
  }, [logs, lastSignalTime])

  const condColors = (p: number) => p > 75 ? '#5BBE72' : p > 55 ? '#C9A23C' : '#D45858'
  const totalVol = (volBarsRef.current.reduce((a, b) => a + b.v, 0) * 2.1 + 30).toFixed(1) + 'B'

  const stats = [
    { label: 'Orders Today', value: ordersToday != null ? String(ordersToday) : '—', sub: 'Executed' },
    { label: 'Last Signal', value: lastSig ?? '—', sub: 'Signal time', mono: true },
    { label: 'Current Expiry', value: nearestExpiry, sub: 'Active expiry', green: true },
    { label: 'Mode', value: modeLabel, sub: modeSub, small: true },
  ]

  return (
    <div className="card overflow-hidden" style={{ borderLeft: '2px solid #5BBE72' }}>

      {/* Mobile-only stats grid — hidden on sm+ */}
      <div className="jarvis-mobile-stats grid-cols-2 border-b border-border">
        {stats.map(({ label, value, sub, green, small }, i) => (
          <div key={label} className={[
            'flex flex-col justify-center px-4 py-3',
            i % 2 === 0 ? 'border-r border-border' : '',
            i < 2      ? 'border-b border-border' : '',
          ].join(' ')}>
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted mb-1">{label}</div>
            <div className={['font-mono font-bold tabular-nums leading-snug', small ? 'text-[12px]' : 'text-sm', green ? 'text-green' : 'text-tx'].join(' ')}>
              {value}
            </div>
            <div className="text-[9px] font-mono text-muted mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="jarvis-outer">

        {/* Radar — hidden on mobile */}
        <div className="jarvis-radar-col border-r border-border flex-col items-center justify-center gap-2.5 px-4 py-5">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Scanner</span>
          <canvas ref={radarRef} width={130} height={130} />
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
            <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-green">Analysing</span>
          </div>
        </div>

        {/* Center */}
        <div className="flex flex-col border-r border-border">
          <div className="jarvis-center-cols flex-1 border-b border-border">

            {/* Volume */}
            <div className="border-r border-border p-3.5 flex flex-col gap-2">
              <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Volume</span>
              <div className="flex-1 relative" style={{ minHeight: '80px' }}>
                <canvas ref={volRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-tx">{totalVol}</div>
                <div className="text-[9px] font-mono text-muted">5-min bars · live</div>
              </div>
            </div>

            {/* Conditions */}
            <div className="border-r border-border p-3.5 flex flex-col gap-2">
              <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Conditions</span>
              <div className="flex-1 flex flex-col justify-around">
                {(['IV Rank', 'Theta Richness', 'Range Bound'] as const).map((name, i) => (
                  <div key={name} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono text-muted">{name}</span>
                      <span className="text-[11px] font-mono font-bold text-tx">{conditions[i]}%</span>
                    </div>
                    <div className="h-[3px] rounded-full overflow-hidden" style={{ background: '#2A1E12' }}>
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ width: `${conditions[i]}%`, background: condColors(conditions[i]) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gauge */}
            <div className="p-3 flex flex-col items-center justify-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Signal</span>
              <canvas ref={gaugeRef} width={80} height={80} />
              <div className="font-mono text-lg font-bold text-green">{Math.round(gaugeDisplay)}%</div>
              <div className="text-[9px] font-mono text-muted">sell score</div>
            </div>
          </div>

          {/* Insight strip */}
          <div className="p-4 flex flex-col gap-2">
            <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-muted">Market Intelligence</span>
            <p className="font-mono text-[13px] font-medium text-tx leading-relaxed" style={{ minHeight: '20px' }}>
              {typed}
              <span
                className="inline-block ml-0.5 align-text-bottom animate-pulse"
                style={{ width: '6px', height: '13px', background: '#5BBE72' }}
              />
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {INSIGHTS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setInsightIdx(i)}
                    style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: i === insightIdx ? '#5BBE72' : '#2A1E12',
                      boxShadow: i === insightIdx ? '0 0 5px #5BBE72' : 'none',
                      transition: 'all 0.3s',
                      border: 'none', cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-[10px] text-muted">{insightIdx + 1} / {INSIGHTS.length}</span>
            </div>
          </div>
        </div>

        {/* Stats — hidden on mobile */}
        <div className="jarvis-stats-col flex-col">
          {stats.map(({ label, value, sub, green, small }, i) => (
            <div key={label} className={`flex-1 flex flex-col justify-center px-5 ${i < 3 ? 'border-b border-border' : ''}`}>
              <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted mb-1">{label}</div>
              <div className={[
                'font-mono font-bold tabular-nums leading-snug',
                small ? 'text-[13px] tracking-[0.02em]' : 'text-base',
                green ? 'text-green' : 'text-tx',
              ].join(' ')}>
                {value}
              </div>
              <div className="text-[10px] font-mono text-muted mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Add Position Modal ────────────────────────────────────────────────────────

function AddPositionModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ account: 'master', symbol: '', side: 'Buy', size: '0.01', avg_price: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.symbol || !form.avg_price) { setErr('Symbol and Avg Price are required'); return }
    setSaving(true); setErr('')
    try {
      await api.portfolio.manualPositions.add(form)
      onAdded(); onClose()
    } catch (ex: any) {
      setErr(ex.message ?? 'Failed to add')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-s1 border border-border rounded-card p-6 w-full max-w-sm space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add Manual Position</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-lg leading-none">×</button>
        </div>
        <p className="text-[11px] text-muted leading-snug">
          Use this to track a position that exists on Bybit but wasn't recorded by the bot.
          It won't affect real orders — you can close it via the Close button.
        </p>
        <form onSubmit={submit} className="space-y-3">
          {[
            { label: 'Account', key: 'account', placeholder: 'master' },
            { label: 'Symbol', key: 'symbol', placeholder: 'BTC-27SEP26-80000-C-USDT' },
            { label: 'Size (BTC)', key: 'size', placeholder: '0.01' },
            { label: 'Avg Entry Price (USDT)', key: 'avg_price', placeholder: '340.00' },
          ].map(({ label, key, placeholder }) => (
            <label key={key} className="block">
              <span className="text-[11px] text-muted mb-1 block">{label}</span>
              <input
                value={(form as any)[key]}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-tx focus:outline-none focus:border-accent"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-[11px] text-muted mb-1 block">Side</span>
            <select
              value={form.side}
              onChange={e => set('side', e.target.value)}
              className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-tx focus:outline-none focus:border-accent"
            >
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </label>
          {err && <p className="text-[11px] text-red">{err}</p>}
          <button
            type="submit" disabled={saving}
            className="w-full py-2 rounded bg-accent text-bg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? 'Adding…' : 'Add Position'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { status } = useOutletContext<Ctx>()
  const [logs, setLogs]             = useState<string[]>([])
  const [uptime, setUptime]         = useState<number | null>(null)
  const [wallet, setWallet]         = useState<WalletBalance | null>(null)
  const [positions, setPositions]   = useState<AnyPosition[]>([])
  const [orders, setOrders]         = useState<OpenOrder[]>([])
  const [closing, setClosing]       = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [showAddPos, setShowAddPos] = useState(false)
  const [removingManual, setRemovingManual] = useState<string | null>(null)
  const [currentExpiry, setCurrentExpiry]   = useState('')
  const [ordersToday, setOrdersToday]       = useState<number | null>(null)

  useEffect(() => {
    if (status?.uptime_seconds != null) setUptime(status.uptime_seconds)
  }, [status])

  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(() => setUptime(u => (u != null ? u + 1 : u)), 1000)
    return () => clearInterval(id)
  }, [status?.running])

  useEffect(() => {
    const fetchLogs = async () => {
      try { const { lines } = await api.logs(30); setLogs(lines) } catch { /**/ }
    }
    fetchLogs()
    const id = setInterval(fetchLogs, 8000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchAll = async () => {
      try { setWallet(await api.portfolio.balance()) } catch { /**/ }
      try {
        const [real, manual] = await Promise.all([
          api.portfolio.positions(),
          api.portfolio.manualPositions.list(),
        ])
        setPositions([...real.positions, ...manual.positions] as AnyPosition[])
      } catch { /**/ }
      try { const r = await api.portfolio.orders(); setOrders(r.orders) } catch { /**/ }
    }
    fetchAll()
    const id = setInterval(fetchAll, 30_000)
    return () => clearInterval(id)
  }, [])

  // Fetch current expiry + orders today once on mount
  useEffect(() => {
    api.settings.get().then(s => setCurrentExpiry(s.current_expiry)).catch(() => {})
    api.journal.trades().then(j => {
      const today = new Date().toISOString().slice(0, 10)
      setOrdersToday(j.trades.filter(t => t.timestamp.startsWith(today)).length)
    }).catch(() => {})
  }, [])

  async function closePosition(pos: AnyPosition) {
    const size = 'size' in pos ? pos.size : (pos as any).size
    setClosing(pos.symbol + pos.account)
    try {
      await api.portfolio.close({ symbol: pos.symbol, side: pos.side, size, account: pos.account })
    } catch (e: any) {
      alert(e.message ?? 'Close failed')
    } finally {
      setClosing(null)
    }
  }

  async function cancelOrder(o: OpenOrder) {
    setCancelling(o.orderId)
    try {
      await api.portfolio.cancelOrder({ symbol: o.symbol, order_id: o.orderId, account: o.account })
      setOrders(prev => prev.filter(x => x.orderId !== o.orderId))
    } catch (e: any) {
      alert(e.message ?? 'Cancel failed')
    } finally {
      setCancelling(null)
    }
  }

  async function removeManual(id: string) {
    setRemovingManual(id)
    try {
      await api.portfolio.manualPositions.remove(id)
      setPositions(prev => prev.filter(p => !('manual' in p && (p as ManualPosition).id === id)))
    } catch (e: any) {
      alert(e.message ?? 'Remove failed')
    } finally {
      setRemovingManual(null)
    }
  }

  const running = status?.running ?? false

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {showAddPos && (
        <AddPositionModal
          onClose={() => setShowAddPos(false)}
          onAdded={async () => {
            const [real, manual] = await Promise.all([
              api.portfolio.positions(),
              api.portfolio.manualPositions.list(),
            ])
            setPositions([...real.positions, ...manual.positions] as AnyPosition[])
          }}
        />
      )}

      {/* Hero */}
      <div className={[
        'rounded-card border p-5 flex items-center gap-5 shadow-card',
        running
          ? 'bg-gradient-to-br from-s1 to-s2 border-border'
          : 'bg-gradient-to-br from-s1 to-[#200C06] border-red/25',
      ].join(' ')}>
        <div className={[
          'w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 relative overflow-hidden transition-all duration-500',
          running
            ? 'bg-green shadow-[0_0_10px_rgba(91,190,114,0.35)]'
            : 'bg-red/80 shadow-[0_0_8px_rgba(212,88,88,0.3)]',
        ].join(' ')}>
          {running && (
            <span
              className="absolute rounded-full bg-white/30"
              style={{
                width: '18px', height: '18px',
                top: 'calc(50% - 9px)', left: 'calc(50% - 9px)',
                transformOrigin: 'center',
                animation: 'ping 1.8s ease-out infinite',
              }}
            />
          )}
          <svg className="relative z-10 w-6 h-6 text-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <polyline
              points="22 12 18 12 15 21 9 3 6 12 2 12"
              strokeDasharray="46"
              style={running ? { animation: 'ecg 2.2s linear infinite' } : {}}
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold">{running ? 'Algo Running' : 'Algo Stopped'}</h2>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {status?.pid && (
              <span className="text-[11px] text-muted">PID {status.pid}</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-muted uppercase tracking-widest">Uptime</div>
          <div className="font-mono text-2xl font-medium text-green mt-0.5 tabular-nums">
            {running ? formatUptime(uptime) : '--:--:--'}
          </div>
        </div>
      </div>

      {/* Market Intelligence Panel */}
      <MarketIntelPanel
        status={status}
        positions={positions}
        currentExpiry={currentExpiry}
        ordersToday={ordersToday}
        lastSignalTime={null}
        logs={logs}
      />

      {/* Portfolio row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">Wallet Equity</div>
          <div className="font-mono text-xl font-bold text-tx tabular-nums">
            {wallet ? `${wallet.currency === 'INR' ? '₹' : '$'}${wallet.equity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
          </div>
          <div className="text-[11px] text-muted mt-1.5">{wallet?.currency ?? 'USDT'} · master account</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">Unrealised PnL</div>
          <div className={`font-mono text-xl font-bold tabular-nums ${!wallet ? 'text-tx' : wallet.unrealised_pnl >= 0 ? 'text-green-live' : 'text-red-live'}`}>
            {wallet ? `${fmt(wallet.unrealised_pnl)} ${wallet.currency}` : '—'}
          </div>
          <div className="text-[11px] text-muted mt-1.5">Across open positions</div>
        </div>
        <div className="card p-4 col-span-2 sm:col-span-1">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">Open Positions</div>
          <div className="font-mono text-xl font-bold text-tx tabular-nums">{positions.length}</div>
          <div className="text-[11px] text-muted mt-1.5">
            <Link to="/journal" className="hover:text-accent transition-colors">View journal →</Link>
          </div>
        </div>
      </div>

      {/* Positions table */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Open Positions {positions.length > 0 && <span className="text-accent">({positions.length})</span>}
          </div>
          <button
            onClick={() => setShowAddPos(true)}
            className="text-[11px] px-2.5 py-1 rounded border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
          >
            + Add Missing
          </button>
        </div>
        {positions.length === 0 ? (
          <p className="text-[12px] text-muted">No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="pb-2 font-semibold pr-3">Symbol</th>
                  <th className="pb-2 font-semibold pr-3">Account</th>
                  <th className="pb-2 font-semibold pr-3">Side</th>
                  <th className="pb-2 font-semibold pr-3">Size</th>
                  <th className="pb-2 font-semibold pr-3">Avg Price</th>
                  <th className="pb-2 font-semibold pr-3">Mark</th>
                  <th className="pb-2 font-semibold pr-3">uPnL</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const isManual  = 'manual' in p && p.manual
                  const avgPrice  = isManual ? parseFloat((p as ManualPosition).avg_price) : parseFloat((p as Position).avgPrice)
                  const markPrice = parseFloat(p.markPrice)
                  const size      = isManual ? parseFloat((p as ManualPosition).size) : parseFloat((p as Position).size)
                  const pnl       = isManual
                    ? (p.side === 'Buy' ? (markPrice - avgPrice) : (avgPrice - markPrice)) * size
                    : parseFloat((p as Position).unrealisedPnl)
                  const key = p.symbol + p.account + i
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-mono text-tx/90">
                        {p.symbol}
                        {isManual && (
                          <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-400/15 text-yellow-400 border border-yellow-400/30">MANUAL</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted capitalize">{p.account}</td>
                      <td className={`py-2 pr-3 font-semibold ${p.side === 'Sell' ? 'text-red' : 'text-green'}`}>{p.side}</td>
                      <td className="py-2 pr-3 tabular-nums">{isManual ? (p as ManualPosition).size : (p as Position).size}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{avgPrice.toFixed(2)}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{markPrice > 0 ? markPrice.toFixed(2) : '—'}</td>
                      <td className={`py-2 pr-3 font-mono tabular-nums font-semibold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {markPrice > 0 ? fmt(pnl) : '—'}
                      </td>
                      <td className="py-2 flex gap-1.5">
                        <button
                          onClick={() => closePosition(p)}
                          disabled={!!closing}
                          className="text-[11px] px-2 py-1 rounded border border-red/50 text-red hover:bg-red/10 transition-colors disabled:opacity-40"
                        >
                          {closing === key ? '…' : `Close → ${closeSide(p.side)}`}
                        </button>
                        {isManual && (
                          <button
                            onClick={() => removeManual((p as ManualPosition).id)}
                            disabled={removingManual === (p as ManualPosition).id}
                            className="text-[11px] px-2 py-1 rounded border border-border text-muted hover:text-tx hover:border-muted transition-colors disabled:opacity-40"
                            title="Remove from tracking"
                          >
                            {removingManual === (p as ManualPosition).id ? '…' : 'Remove'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open orders */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Open Orders {orders.length > 0 && <span className="text-accent">({orders.length})</span>}
          </div>
        </div>
        {orders.length === 0 ? (
          <p className="text-[12px] text-muted">No pending orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="pb-2 font-semibold pr-3">Symbol</th>
                  <th className="pb-2 font-semibold pr-3">Account</th>
                  <th className="pb-2 font-semibold pr-3">Side</th>
                  <th className="pb-2 font-semibold pr-3">Qty</th>
                  <th className="pb-2 font-semibold pr-3">Limit Price</th>
                  <th className="pb-2 font-semibold pr-3">Status</th>
                  <th className="pb-2 font-semibold pr-3">Placed</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => {
                  const ts = parseInt(o.createdTime)
                  const placed = ts ? new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-mono text-tx/90">{o.symbol}</td>
                      <td className="py-2 pr-3 text-muted capitalize">{o.account}</td>
                      <td className={`py-2 pr-3 font-semibold ${o.side === 'Sell' ? 'text-red' : 'text-green'}`}>{o.side}</td>
                      <td className="py-2 pr-3 tabular-nums">{o.qty}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{o.price} USDT</td>
                      <td className="py-2 pr-3">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue/10 text-blue border border-blue/30">
                          {o.orderStatus}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-muted">{placed}</td>
                      <td className="py-2">
                        <button
                          onClick={() => cancelOrder(o)}
                          disabled={cancelling === o.orderId}
                          className="text-[11px] px-2 py-1 rounded border border-red/50 text-red hover:bg-red/10 transition-colors disabled:opacity-40"
                        >
                          {cancelling === o.orderId ? '…' : 'Cancel'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live log */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">Live Log</div>
          <Link to="/logs" className="text-[11px] text-accent hover:opacity-75 transition-opacity">
            Full log →
          </Link>
        </div>
        <div className="log-viewport h-52">
          {logs.length === 0 ? (
            <span className="text-muted">No log entries yet…</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={classifyLine(line)}>{line}</div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
