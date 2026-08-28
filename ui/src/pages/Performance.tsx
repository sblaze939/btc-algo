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

// ── Share Card ────────────────────────────────────────────────────────────────

const CARD_W = 540

function ShareCard({
  entries, stats, current, format, innerRef, overrideGainPct,
}: {
  entries:          GainEntry[]
  stats:            GainsData['stats']
  current:          CurrentExpiryGain | null
  format:           'square' | 'story'
  innerRef?:        React.Ref<HTMLDivElement>
  overrideGainPct?: number
}) {
  const isStory = format === 'story'
  const cardH   = isStory ? 960 : CARD_W
  // Share card always shows gain vs initial balance, but respects user override
  const curGain = overrideGainPct ?? (
    current && stats.initial_balance
      ? parseFloat(((current.total_pnl / stats.initial_balance) * 100).toFixed(2))
      : current?.gain_pct ?? 0
  )
  const isNeg   = curGain < 0
  const allTime = stats.all_time_gain_pct
  const sinceL  = stats.launch_gain_pct

  const MINT  = '#1FCC8C'
  const GOLD  = '#C8A84B'
  const RED   = '#F05252'
  const LINE  = 'rgba(255,255,255,0.06)'
  const GLOW  = isNeg ? '#2A0E0E' : '#1A3520'
  const GLOW2 = isNeg ? 'rgba(60,12,12,0.55)' : 'rgba(20,60,30,0.5)'
  const curC  = isNeg ? RED : MINT

  const fmtG = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%'
  const fmtB = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

  // Real weekly bars from entries
  const barData = entries.slice(-8)
  const maxAbs  = Math.max(...barData.map(e => Math.abs(e.gain_pct)), 0.5)
  const bars    = barData.map((e, i) => ({
    h:    Math.max(8, Math.round((Math.abs(e.gain_pct) / maxAbs) * 90)),
    pos:  e.gain_pct >= 0,
    last: i === barData.length - 1,
  }))

  const p = (n: number): React.CSSProperties => ({ padding: n })
  const abs: React.CSSProperties = { position: 'absolute' }
  const none: React.CSSProperties = { pointerEvents: 'none' }

  return (
    <div ref={innerRef} style={{
      width: CARD_W, height: cardH, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Barlow Condensed', 'Space Grotesk', system-ui, sans-serif",
    }}>
      {/* ── Background layers ── */}
      <div style={{ ...abs, inset: 0, background: [
        `radial-gradient(ellipse 65% 50% at 50% 46%, ${GLOW} 0%, transparent 68%)`,
        `radial-gradient(ellipse 40% 30% at 80% 80%, ${GLOW2} 0%, transparent 60%)`,
        `radial-gradient(ellipse 35% 25% at 10% 15%, rgba(200,168,75,0.04) 0%, transparent 65%)`,
        `linear-gradient(180deg, #090E0B 0%, #0B150D 20%, #0F1E14 45%, #0B150D 80%, #090E0B 100%)`,
      ].join(', ') }} />
      <div style={{ ...abs, inset: 0, ...none, backgroundImage: [
        'repeating-linear-gradient(-45deg, transparent 0px, transparent 34px, rgba(200,168,75,0.022) 34px, rgba(200,168,75,0.022) 35px)',
        'repeating-linear-gradient(0deg, transparent 0px, transparent 18px, rgba(255,255,255,0.01) 18px, rgba(255,255,255,0.01) 19px)',
        'repeating-linear-gradient(90deg, transparent 0px, transparent 28px, rgba(255,255,255,0.007) 28px, rgba(255,255,255,0.007) 29px)',
      ].join(', ') }} />

      {/* ₿ watermark */}
      <div style={{ ...abs, ...none, userSelect: 'none', zIndex: 1,
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
        fontSize: isStory ? 380 : 300, color: 'rgba(200,168,75,0.045)',
        right: -30, top: '50%', transform: 'translateY(-52%) rotate(-8deg)', lineHeight: 1,
      }}>₿</div>

      {/* Corner brackets */}
      {[
        { top: 10, left: 10,  borderTop: '1px solid rgba(200,168,75,0.35)', borderLeft:  '1px solid rgba(200,168,75,0.35)' },
        { top: 10, right: 10, borderTop: '1px solid rgba(200,168,75,0.2)',  borderRight: '1px solid rgba(200,168,75,0.2)' },
        { bottom: 10, left: 10,  borderBottom: '1px solid rgba(200,168,75,0.2)',  borderLeft:  '1px solid rgba(200,168,75,0.2)' },
        { bottom: 10, right: 10, borderBottom: '1px solid rgba(200,168,75,0.35)', borderRight: '1px solid rgba(200,168,75,0.35)' },
      ].map((s, i) => <div key={i} style={{ ...abs, ...none, zIndex: 3, width: 16, height: 16, ...s }} />)}

      {/* Gold diagonal slashes */}
      {[
        { height: 240, top: -20, right: 68, opacity: 1 },
        { height: 170, top:  50, right: 42, opacity: 0.5 },
        { height: 120, bottom: 80, right: 120, opacity: 0.25 },
      ].map((s, i) => <div key={i} style={{ ...abs, ...none, zIndex: 2, width: 1,
        background: 'linear-gradient(180deg, transparent, rgba(200,168,75,0.2), transparent)',
        transform: 'rotate(-35deg)', transformOrigin: 'top center', ...s,
      }} />)}

      {/* Left accent bar */}
      <div style={{ ...abs, ...none, zIndex: 3, left: 0, top: '20%', bottom: '20%', width: 2,
        background: 'linear-gradient(180deg, transparent, rgba(200,168,75,0.18), transparent)',
      }} />

      {/* Cross marks */}
      {[{ top: '42%', left: '18%' } as React.CSSProperties, { top: '68%', right: '22%' } as React.CSSProperties].map((pos, i) => (
        <div key={i} style={{ ...abs, ...none, zIndex: 3, ...pos }}>
          <div style={{ ...abs, width: 8, height: 1, top: 0, left: -4, background: 'rgba(200,168,75,0.2)' }} />
          <div style={{ ...abs, width: 1, height: 8, top: -4, left:  0, background: 'rgba(200,168,75,0.2)' }} />
        </div>
      ))}

      {/* Candlestick bars — real data */}
      <svg style={{ ...abs, ...none, zIndex: 1, bottom: 0, left: 0, width: '100%', height: 120 }}
        viewBox={`0 0 ${CARD_W} 110`} preserveAspectRatio="none">
        {bars.map((bar, i) => {
          const x     = 30 + i * 68
          const bH    = Math.round(bar.h * 0.8)
          const wH    = bar.h + 8
          const baseY = 105
          const fillC = bar.pos ? `rgba(31,204,140,${bar.last ? 0.45 : 0.22})` : `rgba(240,82,82,${bar.last ? 0.42 : 0.2})`
          const strkC = bar.pos ? `rgba(31,204,140,${bar.last ? 0.65 : 0.35})` : `rgba(240,82,82,${bar.last ? 0.6 : 0.3})`
          return (
            <g key={i}>
              <line x1={x} y1={baseY - wH} x2={x} y2={baseY} stroke={strkC} strokeWidth="1" />
              <rect x={x - 7} y={baseY - bH} width="14" height={bH} fill={fillC} />
            </g>
          )
        })}
      </svg>

      {/* Top gold bar */}
      <div style={{ position: 'relative', zIndex: 3, height: 2, flexShrink: 0,
        background: `linear-gradient(90deg, ${GOLD} 0%, rgba(200,168,75,0.15) 65%, transparent 100%)`,
      }} />
      {/* Bottom accent */}
      <div style={{ ...abs, ...none, zIndex: 3, bottom: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(200,168,75,0.2), transparent)',
      }} />

      {/* ── Card content ── */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '17px 24px 15px', borderBottom: `1px solid ${LINE}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 800,
              display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ color: '#fff' }}>Kirasha</span>
              <span style={{ color: GOLD }}>BTC Algo</span>
            </div>
            <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.13em',
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>
              BTC Options — Weekly Performance
            </div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(31,204,140,0.1)', border: '1px solid rgba(31,204,140,0.22)',
            padding: '5px 11px', fontSize: 9, fontWeight: 600,
            letterSpacing: '0.13em', textTransform: 'uppercase', color: MINT }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: MINT }} />
            Live
          </div>
        </div>

        {/* All-time return */}
        <div style={{ padding: isStory ? '24px 24px 22px' : '16px 24px 13px',
          flexShrink: 0, borderBottom: `1px solid ${LINE}` }}>
          <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: GOLD, display: 'block', marginBottom: 5 }}>
            All-Time Return
          </span>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: isStory ? 108 : 84, fontWeight: 800,
            lineHeight: 0.88, letterSpacing: '-0.02em', color: MINT,
            fontVariantNumeric: 'tabular-nums' }}>
            {fmtB(allTime)}
          </div>
        </div>

        {/* Current Expiry + Since Sep 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          flexShrink: 0, borderBottom: `1px solid ${LINE}` }}>
          {[
            { label: 'Current Expiry', val: fmtG(curGain), color: curC },
            { label: 'Since Sep 2',    val: fmtG(sinceL),  color: sinceL >= 0 ? MINT : RED, right: true },
          ].map(col => (
            <div key={col.label} style={{
              padding: isStory ? '20px 24px' : '13px 24px',
              borderLeft: (col as any).right ? `1px solid ${LINE}` : undefined,
            }}>
              <span style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)',
                display: 'block', marginBottom: 5 }}>{col.label}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: isStory ? 40 : 30, fontWeight: 800,
                color: col.color, display: 'block', lineHeight: 1,
                fontVariantNumeric: 'tabular-nums' }}>{col.val}</span>
            </div>
          ))}
        </div>

        {/* Story-only mid section */}
        {isStory && (
          <div style={{ flex: 1, padding: '28px 24px 30px',
            borderBottom: `1px solid ${LINE}`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 56, fontWeight: 800, textTransform: 'uppercase',
              lineHeight: 0.88, letterSpacing: '-0.01em', color: '#fff' }}>
              Zero Emotion.<br /><span style={{ color: GOLD }}>Pure Alpha.</span>
            </div>
            <p style={{ fontSize: 12, fontWeight: 300, lineHeight: 1.7,
              color: 'rgba(255,255,255,0.55)', marginTop: 14 }}>
              AI analyses market conditions across 10 parameters and scores the
              confidence of each setup — only executes when the threshold is met.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 20 }}>
              {['Instant Execution', 'AI Scored', 'Risk Managed', 'Always On'].map(tag => (
                <span key={tag} style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.13em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)',
                  border: '1px solid rgba(255,255,255,0.1)', padding: '5px 11px' }}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Win Rate + Weeks */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
          flex: isStory ? '0 0 auto' : 1 }}>
          {[
            { label: 'Win Rate',     val: stats.win_rate.toFixed(0) + '%', color: MINT },
            { label: 'Weeks Traded', val: String(stats.total_weeks),       color: '#fff', right: true },
          ].map(st => (
            <div key={st.label} style={{
              padding: isStory ? '22px 24px' : '0 24px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              borderLeft: (st as any).right ? `1px solid ${LINE}` : undefined,
            }}>
              <span style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: '0.16em',
                textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)',
                display: 'block', marginBottom: 5 }}>{st.label}</span>
              <span style={{ fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: isStory ? 52 : 38, fontWeight: 800,
                color: st.color, display: 'block', lineHeight: 1,
                fontVariantNumeric: 'tabular-nums' }}>{st.val}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '11px 24px', borderTop: `1px solid ${LINE}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 7, fontWeight: 300, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)' }}>
            <span>BTC Options</span>
            <span style={{ width: 2, height: 2, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'inline-block' }} />
            <span>Algo Trading</span>
            <span style={{ width: 2, height: 2, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'inline-block' }} />
            <span>Managed</span>
          </div>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: GOLD }}>kirasha.in</span>
        </div>
      </div>
    </div>
  )
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
  const [format, setFormat]       = useState<'square' | 'story'>('square')
  const [downloading, setDL]      = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Editable gain% — pre-filled from total_pnl / initial_balance (ephemeral, not stored)
  const defaultGain = current && stats.initial_balance
    ? parseFloat(((current.total_pnl / stats.initial_balance) * 100).toFixed(2))
    : current?.gain_pct ?? 0
  const [editGain, setEditGain]   = useState<string>(String(defaultGain))
  const parsedGain = parseFloat(editGain)
  const gainValid  = !isNaN(parsedGain)

  const isStory  = format === 'story'
  const cardH    = isStory ? 960 : CARD_W
  const scale    = isStory ? 260 / CARD_W : 380 / CARD_W
  const previewH = Math.round(cardH * scale)

  async function download() {
    const el = cardRef.current
    if (!el || downloading) return
    setDL(true)
    try {
      await document.fonts.ready
      const h2c     = (await import('html2canvas')).default
      const canvas  = await h2c(el, { scale: 2, useCORS: true, logging: false, backgroundColor: null })
      const today   = new Date().toISOString().slice(0, 10)
      const a       = document.createElement('a')
      a.download    = `kirasha-perf-${today}-${format}.png`
      a.href        = canvas.toDataURL('image/png')
      a.click()
    } finally {
      setDL(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-s1 border border-border rounded-card p-6 w-full max-w-lg shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-tx">Share Weekly Performance</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">×</button>
        </div>

        {/* Format toggle */}
        <div className="flex gap-2">
          {(['square', 'story'] as const).map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={format === f ? 'btn-accent text-xs px-3 py-1' : 'btn-ghost text-xs px-3 py-1'}>
              {f === 'square' ? 'Square Post' : 'Story 9:16'}
            </button>
          ))}
        </div>

        {/* Editable return — ephemeral, only affects the share card */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted font-mono flex-shrink-0">Current expiry return on card:</span>
          <div className="relative flex items-center">
            <input
              type="number"
              step="0.01"
              value={editGain}
              onChange={e => setEditGain(e.target.value)}
              className={`font-mono text-xs px-2 py-1 rounded border bg-s2 w-24 text-right ${gainValid ? (parsedGain >= 0 ? 'text-green border-green/30' : 'text-red border-red/30') : 'text-muted border-border'}`}
            />
            <span className="absolute right-2 text-[10px] text-muted pointer-events-none">%</span>
          </div>
          {editGain !== String(defaultGain) && (
            <button onClick={() => setEditGain(String(defaultGain))}
              className="text-[10px] text-muted hover:text-tx underline flex-shrink-0">reset</button>
          )}
        </div>

        {/* Scaled preview — wrap to exact scaled dimensions so clip is clean */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: Math.round(CARD_W * scale), height: previewH, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: CARD_W, flexShrink: 0 }}>
              <ShareCard entries={entries} stats={stats} current={current} format={format} innerRef={cardRef}
                overrideGainPct={gainValid ? parsedGain : undefined} />
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted font-mono">
          {isStory ? 'Story 9:16 — exports 1080×1920 PNG' : 'Square — exports 1080×1080 PNG'}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">Close</button>
          <button onClick={download} disabled={downloading} className="btn-accent text-xs px-4 py-1.5">
            {downloading ? 'Generating…' : `↓ Download ${isStory ? '1080×1920' : '1080×1080'}`}
          </button>
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
  const [showAdd,     setShowAdd]     = useState(false)
  const [shareTarget, setShareTarget] = useState<GainEntry | 'live' | null>(null)
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
            onClick={() => setShareTarget('live')}
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
          {cur && !cur.error ? (() => {
            const gainVsCycle   = cur.gain_pct  // already cycle-start based
            const gainVsInitial = stats.initial_balance
              ? parseFloat(((cur.total_pnl / stats.initial_balance) * 100).toFixed(2))
              : gainVsCycle
            return (
              <>
                <div className={`font-mono text-3xl font-bold leading-none ${pctClass(gainVsCycle)}`}>
                  {fmtPct(gainVsCycle, true)}
                </div>
                <div className="text-[11px] text-muted mt-1.5 font-mono space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] ${pctClass(gainVsInitial)}`}>
                      {fmtPct(gainVsInitial, true)}
                    </span>
                    <span className="text-[9px] text-muted2">vs initial</span>
                    <span className="text-muted2 text-[9px]">·</span>
                    <span className={cur.total_pnl >= 0 ? 'text-green text-[10px]' : 'text-red text-[10px]'}>
                      {cur.total_pnl >= 0 ? '+' : '−'}${Math.abs(cur.total_pnl).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10px]">
                    {cur.expiry} · R: ${cur.realized_pnl.toFixed(2)} · U: ${cur.unrealized_pnl.toFixed(2)}
                  </div>
                </div>
              </>
            )
          })() : (
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
                    className={`group border-b border-border hover:bg-s2/50 transition-colors ${isBreak ? 'opacity-40' : ''}`}
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
                      <div className="flex items-center gap-2">
                        {!isBreak && (
                          <div
                            className={`h-[3px] rounded-full ${e.gain_pct >= 0 ? 'bg-green' : 'bg-red'}`}
                            style={{ width: barW }}
                          />
                        )}
                        {!isBreak && (
                          <button
                            onClick={() => setShareTarget(e)}
                            title="Share this week's card"
                            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-accent text-xs leading-none flex-shrink-0"
                            style={{ fontSize: 13 }}
                          >
                            ↑
                          </button>
                        )}
                      </div>
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
      {shareTarget != null && (() => {
        const shareCurrent: CurrentExpiryGain | null =
          shareTarget === 'live'
            ? cur
            : {
                expiry:             shareTarget.expiry,
                expiry_iso:         shareTarget.expiry,
                gain_pct:           shareTarget.gain_pct,
                realized_pnl:       shareTarget.realized_usdt ?? shareTarget.gain_pct / 100 * (shareTarget.starting_balance ?? 531),
                unrealized_pnl:     0,
                total_pnl:          shareTarget.realized_usdt ?? shareTarget.gain_pct / 100 * (shareTarget.starting_balance ?? 531),
                starting_balance:   shareTarget.starting_balance ?? 531,
                is_live:            false,
                all_positions_flat: true,
              }
        return (
          <ShareModal entries={entries} stats={stats} current={shareCurrent} onClose={() => setShareTarget(null)} />
        )
      })()}
    </div>
  )
}
