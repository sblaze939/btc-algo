import { useEffect, useState, useRef } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { api, BotStatus, Position, WalletBalance } from '../api'

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
  const s = Math.abs(n).toFixed(decimals)
  return (n < 0 ? '−' : '+') + s
}

function closeSide(side: string) { return side === 'Sell' ? 'Buy' : 'Sell' }

interface PlaceOrderForm {
  symbol: string; side: 'Buy' | 'Sell'; qty: string
  order_type: 'Market' | 'Limit'; price: string
}

function PlaceOrderModal({ onClose, onPlaced }: { onClose: () => void; onPlaced: () => void }) {
  const [form, setForm] = useState<PlaceOrderForm>({ symbol: '', side: 'Sell', qty: '0.01', order_type: 'Market', price: '' })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  async function submit() {
    if (!form.symbol.trim()) { setErr('Symbol required'); return }
    if (!form.qty.trim()) { setErr('Qty required'); return }
    if (form.order_type === 'Limit' && !form.price.trim()) { setErr('Price required for Limit order'); return }
    setLoading(true); setErr('')
    try {
      await api.portfolio.placeOrder({
        symbol: form.symbol.trim().toUpperCase(),
        side: form.side,
        qty: form.qty.trim(),
        order_type: form.order_type,
        price: form.order_type === 'Limit' ? form.price.trim() : undefined,
        account: 'master',
      })
      onPlaced()
      onClose()
    } catch (e: any) {
      setErr(e.message ?? 'Order failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="bg-s1 border border-border rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">Place Order</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted uppercase tracking-wider block mb-1">Symbol</label>
            <input className="input font-mono text-xs w-full" placeholder="BTC-28AUG26-64000-P-USDT"
              value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted uppercase tracking-wider block mb-1">Side</label>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(['Sell', 'Buy'] as const).map(s => (
                  <button key={s} onClick={() => setForm(f => ({ ...f, side: s }))}
                    className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${form.side === s ? (s === 'Sell' ? 'bg-red text-white' : 'bg-green text-bg') : 'bg-s2 text-muted hover:text-tx'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted uppercase tracking-wider block mb-1">Qty (lots)</label>
              <input className="input font-mono text-xs w-full" placeholder="0.01"
                value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted uppercase tracking-wider block mb-1">Order Type</label>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(['Market', 'Limit'] as const).map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, order_type: t }))}
                    className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${form.order_type === t ? 'bg-accent text-bg' : 'bg-s2 text-muted hover:text-tx'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {form.order_type === 'Limit' && (
              <div>
                <label className="text-[11px] text-muted uppercase tracking-wider block mb-1">Price</label>
                <input className="input font-mono text-xs w-full" placeholder="25.00"
                  value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
            )}
          </div>
        </div>

        {err && <p className="text-red text-[12px]">{err}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={loading}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 ${form.side === 'Sell' ? 'bg-red text-white hover:bg-red/80' : 'bg-green text-bg hover:bg-green/80'}`}>
            {loading ? 'Placing…' : `${form.side} ${form.qty || '?'} lots`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { status } = useOutletContext<Ctx>()
  const [logs, setLogs] = useState<string[]>([])
  const [uptime, setUptime] = useState<number | null>(null)
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [closing, setClosing] = useState<string | null>(null)
  const [showPlaceOrder, setShowPlaceOrder] = useState(false)

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

  // Fetch wallet + positions every 30s
  useEffect(() => {
    const fetch = async () => {
      try { setWallet(await api.portfolio.balance()) } catch { /**/ }
      try { const r = await api.portfolio.positions(); setPositions(r.positions) } catch { /**/ }
    }
    fetch()
    const id = setInterval(fetch, 30_000)
    return () => clearInterval(id)
  }, [])

  async function refreshPositions() {
    try { const r = await api.portfolio.positions(); setPositions(r.positions) } catch { /**/ }
  }

  async function closePosition(pos: Position) {
    setClosing(pos.symbol + pos.account)
    try {
      await api.portfolio.close({ symbol: pos.symbol, side: pos.side, size: pos.size, account: pos.account })
      await refreshPositions()
    } catch (e: any) {
      alert(e.message ?? 'Close failed')
    } finally {
      setClosing(null)
    }
  }

  const running = status?.running ?? false

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {showPlaceOrder && <PlaceOrderModal onClose={() => setShowPlaceOrder(false)} onPlaced={refreshPositions} />}

      {/* Hero status */}
      <div className={[
        'rounded-card border p-5 flex items-center gap-5 shadow-card',
        running
          ? 'bg-gradient-to-br from-s1 to-s2 border-border'
          : 'bg-gradient-to-br from-s1 to-[#200C06] border-red/25',
      ].join(' ')}>
        <div className={[
          'w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500',
          running
            ? 'bg-green shadow-[0_0_10px_rgba(91,190,114,0.35)]'
            : 'bg-red/80 shadow-[0_0_8px_rgba(212,88,88,0.3)] animate-pulse',
        ].join(' ')}>
          <svg className="w-6 h-6 text-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold">{running ? 'Bot Running' : 'Bot Stopped'}</h2>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {status && (
              <>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${status.dry_run ? 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10' : 'text-green border-green/40 bg-green/10'}`}>
                  {status.dry_run ? 'DRY RUN' : 'LIVE TRADING'}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border text-blue border-blue/40 bg-blue/10 capitalize">
                  {status.signal_mode} mode
                </span>
                {status.pid && (
                  <span className="text-[11px] text-muted">PID {status.pid}</span>
                )}
              </>
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

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Signal Mode', value: (status?.signal_mode ?? '…').toUpperCase(), sub: 'Gemini Vision / text parser', color: 'text-blue/80' },
          { label: 'Trading Mode', value: status ? (status.dry_run ? 'DRY RUN' : 'LIVE') : '…', sub: status?.dry_run ? 'No real orders placed' : 'Real orders active', color: status?.dry_run ? 'text-[#C8A030]' : 'text-green-live' },
          { label: 'Go-Live Date', value: status?.live_from ?? '…', sub: 'Safety gate — orders blocked before this', color: 'text-tx/70' },
          { label: 'Bot Status', value: running ? 'Online' : 'Offline', sub: running ? `PID ${status?.pid}` : 'Click Start to begin', color: running ? 'text-green-live' : 'text-red-live' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card p-4">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">{label}</div>
            <div className={`font-mono font-bold text-xl leading-none mb-1.5 ${color}`}>{value}</div>
            <div className="text-[11px] text-muted2 leading-snug">{sub}</div>
          </div>
        ))}
      </div>

      {/* Portfolio row: wallet balance + unrealized PnL */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">Wallet Equity</div>
          <div className="font-mono text-xl font-bold text-tx tabular-nums">
            {wallet ? `${wallet.currency === 'INR' ? '₹' : '$'}${wallet.equity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
          </div>
          <div className="text-[11px] text-muted mt-1.5">{wallet?.currency ?? 'INR'} · master account</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2.5">Unrealised PnL</div>
          <div className={`font-mono text-xl font-bold tabular-nums ${
            !wallet ? 'text-tx' : wallet.unrealised_pnl >= 0 ? 'text-green-live' : 'text-red-live'
          }`}>
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

      {/* Open positions table — always show, even if empty */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Open Positions ({positions.length})
          </div>
          <button
            onClick={() => setShowPlaceOrder(true)}
            className="text-[11px] px-3 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-colors font-semibold"
          >
            + Place Order
          </button>
        </div>
        {positions.length === 0 ? (
          <p className="text-muted text-[12px]">No open positions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="pb-2 font-semibold pr-4">Symbol</th>
                  <th className="pb-2 font-semibold pr-4">Account</th>
                  <th className="pb-2 font-semibold pr-4">Side</th>
                  <th className="pb-2 font-semibold pr-4">Size</th>
                  <th className="pb-2 font-semibold pr-4">Avg Price</th>
                  <th className="pb-2 font-semibold pr-4">Mark</th>
                  <th className="pb-2 font-semibold pr-4">uPnL</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const pnl = parseFloat(p.unrealisedPnl)
                  const key = p.symbol + p.account
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4 font-mono text-tx/90">{p.symbol}</td>
                      <td className="py-2 pr-4 text-muted capitalize">{p.account}</td>
                      <td className={`py-2 pr-4 font-semibold ${p.side === 'Sell' ? 'text-red' : 'text-green'}`}>{p.side}</td>
                      <td className="py-2 pr-4 tabular-nums">{p.size}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums">{parseFloat(p.avgPrice).toFixed(2)}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums">{parseFloat(p.markPrice).toFixed(2)}</td>
                      <td className={`py-2 pr-4 font-mono tabular-nums font-semibold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {fmt(pnl)}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => closePosition(p)}
                          disabled={!!closing}
                          className="text-[11px] px-2 py-1 rounded border border-red/50 text-red hover:bg-red/10 transition-colors disabled:opacity-40"
                        >
                          {closing === key ? '…' : `Close → ${closeSide(p.side)}`}
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
