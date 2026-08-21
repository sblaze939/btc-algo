import { useEffect, useState } from 'react'
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
  const s = Math.abs(n).toFixed(decimals)
  return (n < 0 ? '−' : '+') + s
}

function closeSide(side: string) { return side === 'Sell' ? 'Buy' : 'Sell' }

type AnyPosition = (Position & { manual?: false }) | ManualPosition

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

export default function Dashboard() {
  const { status } = useOutletContext<Ctx>()
  const [logs, setLogs] = useState<string[]>([])
  const [uptime, setUptime] = useState<number | null>(null)
  const [wallet, setWallet] = useState<WalletBalance | null>(null)
  const [positions, setPositions] = useState<AnyPosition[]>([])
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [closing, setClosing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [showAddPos, setShowAddPos] = useState(false)
  const [removingManual, setRemovingManual] = useState<string | null>(null)


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

  // Fetch wallet + positions + orders + manual positions every 30s
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

      {/* Hero status */}
      <div className={[
        'rounded-card border p-5 flex items-center gap-5 shadow-card',
        running
          ? 'bg-gradient-to-br from-s1 to-s2 border-border'
          : 'bg-gradient-to-br from-s1 to-[#200C06] border-red/25',
      ].join(' ')}>
        {/* Orb — no pulse when running normally; pulse only on stopped to draw attention */}
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
          { label: 'Go-Live Date', value: status?.live_from || 'Not set', sub: status?.live_from ? 'Orders blocked before this date' : 'No date gate — trading now', color: status?.live_from ? 'text-tx/70' : 'text-muted' },
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
          <div className="font-mono text-xl font-bold text-tx tabular-nums">
            {positions.length}
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            <Link to="/journal" className="hover:text-accent transition-colors">View journal →</Link>
          </div>
        </div>
      </div>

      {/* Open positions table */}
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
                  const isManual = 'manual' in p && p.manual
                  const avgPrice = isManual ? parseFloat((p as ManualPosition).avg_price) : parseFloat((p as Position).avgPrice)
                  const markPrice = parseFloat(p.markPrice)
                  const size = isManual ? parseFloat((p as ManualPosition).size) : parseFloat((p as Position).size)
                  const pnl = isManual
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
                            title="Remove from tracking (does not cancel on Bybit)"
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
