import { useEffect, useState } from 'react'
import { api, Account, AccountDetail, Execution, OpenOrder, PlaceOrderInput, SymbolMatch } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  const s = Math.abs(n).toFixed(d)
  return (n < 0 ? '−' : '+') + s
}

function closeSide(side: string) { return side === 'Sell' ? 'Buy' : 'Sell' }

function parseTs(ms: string) {
  const n = parseInt(ms)
  if (!n) return '—'
  return new Date(n).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
}

// ── Place Order modal ─────────────────────────────────────────────────────────

function PlaceOrderModal({ idx, accountName, onClose, onPlaced }: {
  idx: number; accountName: string; onClose: () => void; onPlaced: () => void
}) {
  const [step, setStep] = useState<'search' | 'order'>('search')
  const [strike, setStrike] = useState('')
  const [optType, setOptType] = useState<'C' | 'P'>('C')
  const [searching, setSearching] = useState(false)
  const [symbols, setSymbols] = useState<SymbolMatch[]>([])
  const [selected, setSelected] = useState<SymbolMatch | null>(null)
  const [searchErr, setSearchErr] = useState('')

  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy')
  const [qty, setQty] = useState('0.01')
  const [orderType, setOrderType] = useState<'Market' | 'Limit'>('Limit')
  const [price, setPrice] = useState('')
  const [placing, setPlacing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function searchSymbols() {
    const s = parseInt(strike)
    if (!s) { setSearchErr('Enter a valid strike (e.g. 58000)'); return }
    setSearching(true); setSearchErr(''); setSymbols([])
    try {
      const r = await api.market.symbols(s, optType)
      if (!r.symbols.length) setSearchErr(`No contracts found for ${s} ${optType === 'C' ? 'Call' : 'Put'}`)
      setSymbols(r.symbols)
    } catch (e: any) {
      setSearchErr(e.message ?? 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  function selectSymbol(sym: SymbolMatch) {
    setSelected(sym)
    // Pre-fill limit price with ask (for Buy) or bid (for Sell) rounded to nearest 5
    const ask = parseFloat(sym.ask)
    if (ask > 0) {
      const rounded = Math.round(ask / 5) * 5
      setPrice(String(rounded))
    }
    setStep('order')
  }

  async function placeOrder() {
    if (!selected) return
    setPlacing(true); setResult(null)
    const input: PlaceOrderInput = {
      symbol:     selected.symbol,
      side,
      qty,
      order_type: orderType,
    }
    if (orderType === 'Limit' && price) input.price = price
    try {
      const r = await api.accounts.placeOrder(idx, input)
      if (r.dry_run) {
        setResult({ ok: true, text: `DRY RUN — no real order. Would ${side} ${qty} BTC of ${selected.symbol}` })
      } else {
        setResult({ ok: true, text: `Order placed! ID: ${r.orderId}` })
        onPlaced()
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message ?? 'Order failed' })
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-s1 border border-border rounded-card p-6 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Place Order</h3>
            <p className="text-[11px] text-muted mt-0.5">{accountName}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">×</button>
        </div>

        {step === 'search' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-muted block mb-1">Strike</label>
                <input
                  value={strike}
                  onChange={e => setStrike(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchSymbols()}
                  placeholder="e.g. 58000"
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-tx focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-1">Type</label>
                <div className="flex border border-border rounded overflow-hidden">
                  {(['C', 'P'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setOptType(t)}
                      className={`px-4 py-1.5 text-sm font-semibold transition-colors ${optType === t ? 'bg-accent text-bg' : 'text-muted hover:text-tx'}`}
                    >
                      {t === 'C' ? 'CE' : 'PE'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  onClick={searchSymbols}
                  disabled={searching}
                  className="px-4 py-1.5 bg-accent text-bg text-sm font-semibold rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {searching ? '…' : 'Search'}
                </button>
              </div>
            </div>

            {searchErr && <p className="text-[11px] text-red">{searchErr}</p>}

            {symbols.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-muted border-b border-border">
                      <th className="pb-1.5 pr-3 font-semibold">Symbol / Expiry</th>
                      <th className="pb-1.5 pr-3 font-semibold">Ask</th>
                      <th className="pb-1.5 pr-3 font-semibold">Bid</th>
                      <th className="pb-1.5 pr-3 font-semibold">Mark</th>
                      <th className="pb-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map((s, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-s2/50 cursor-pointer" onClick={() => selectSymbol(s)}>
                        <td className="py-1.5 pr-3 font-mono text-tx/90">{s.symbol}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{parseFloat(s.ask) > 0 ? s.ask : '—'}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{parseFloat(s.bid) > 0 ? s.bid : '—'}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{parseFloat(s.mark) > 0 ? parseFloat(s.mark).toFixed(1) : '—'}</td>
                        <td className="py-1.5">
                          <span className="text-[11px] text-accent">Select →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {step === 'order' && selected && (
          <div className="space-y-4">
            <div className="bg-s2 border border-border rounded p-3 text-[12px]">
              <div className="font-mono text-tx/90 font-semibold">{selected.symbol}</div>
              <div className="text-muted mt-0.5">Ask: {selected.ask} · Bid: {selected.bid} · Mark: {parseFloat(selected.mark).toFixed(1)}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted block mb-1">Side</label>
                <div className="flex border border-border rounded overflow-hidden">
                  {(['Buy', 'Sell'] as const).map(v => (
                    <button key={v} onClick={() => setSide(v)}
                      className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${
                        side === v
                          ? v === 'Buy' ? 'bg-green text-bg' : 'bg-red text-bg'
                          : 'text-muted hover:text-tx'
                      }`}
                    >{v}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-1">Order Type</label>
                <div className="flex border border-border rounded overflow-hidden">
                  {(['Limit', 'Market'] as const).map(v => (
                    <button key={v} onClick={() => setOrderType(v)}
                      className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${orderType === v ? 'bg-accent text-bg' : 'text-muted hover:text-tx'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-1">Qty (BTC)</label>
                <input value={qty} onChange={e => setQty(e.target.value)}
                  className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-tx focus:outline-none focus:border-accent"
                />
              </div>
              {orderType === 'Limit' && (
                <div>
                  <label className="text-[11px] text-muted block mb-1">Limit Price (USDT)</label>
                  <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 35"
                    className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-tx focus:outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            {result && (
              <p className={`text-[12px] px-3 py-2 rounded border ${result.ok ? 'text-green border-green/30 bg-green/5' : 'text-red border-red/30 bg-red/5'}`}>
                {result.text}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={() => { setStep('search'); setResult(null) }}
                className="flex-1 py-2 rounded border border-border text-muted text-sm hover:text-tx transition-colors">
                ← Back
              </button>
              <button
                onClick={placeOrder} disabled={placing}
                className={`flex-1 py-2 rounded text-bg text-sm font-semibold transition-opacity disabled:opacity-40 ${side === 'Buy' ? 'bg-green' : 'bg-red'}`}
              >
                {placing ? 'Placing…' : `${side} ${qty} BTC`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Trading() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selIdx, setSelIdx] = useState(0)
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [orders, setOrders] = useState<OpenOrder[]>([])
  const [execs, setExecs] = useState<Execution[]>([])
  const [totalPnl, setTotalPnl] = useState(0)
  const [loading, setLoading] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [showOrder, setShowOrder] = useState(false)

  useEffect(() => {
    api.accounts.list().then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    if (!accounts.length) return
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [selIdx, accounts])

  async function load() {
    setLoading(true)
    try {
      const [det, ords, ex] = await Promise.all([
        api.accounts.detail(selIdx),
        api.accounts.orders(selIdx),
        api.accounts.executions(selIdx),
      ])
      setDetail(det)
      setOrders(ords.orders)
      setExecs(ex.executions)
      setTotalPnl(ex.total_realised_pnl)
    } catch { /**/ } finally {
      setLoading(false)
    }
  }

  async function closePosition(symbol: string, side: string, size: string, account: string) {
    setClosing(symbol)
    try {
      await api.portfolio.close({ symbol, side, size, account })
      await load()
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

  const acct = accounts[selIdx]

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {showOrder && acct && (
        <PlaceOrderModal
          idx={selIdx}
          accountName={acct.name}
          onClose={() => setShowOrder(false)}
          onPlaced={() => { setShowOrder(false); load() }}
        />
      )}

      {/* Account tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {accounts.map((a, i) => (
          <button
            key={i}
            onClick={() => setSelIdx(i)}
            className={[
              'px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors',
              selIdx === i
                ? 'bg-accent text-bg border-accent'
                : 'bg-s1 text-muted border-border hover:text-tx',
            ].join(' ')}
          >
            {a.name}
            {a.is_master && <span className="ml-1 text-[9px] opacity-60">MASTER</span>}
          </button>
        ))}
        <button
          onClick={() => setShowOrder(true)}
          disabled={!accounts.length}
          className="ml-auto px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-accent text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
        >
          + Place Order
        </button>
      </div>

      {/* Wallet stats */}
      {detail && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Equity', value: `${detail.wallet.equity.toFixed(2)} ${detail.wallet.currency}`, color: 'text-tx' },
            { label: 'Wallet Balance', value: `${detail.wallet.wallet_balance.toFixed(2)} ${detail.wallet.currency}`, color: 'text-tx' },
            { label: 'Unrealised PnL', value: `${fmt(detail.wallet.unrealised_pnl)} ${detail.wallet.currency}`, color: detail.wallet.unrealised_pnl >= 0 ? 'text-green' : 'text-red' },
            { label: 'Realised PnL', value: `${fmt(totalPnl)} USDT`, color: totalPnl >= 0 ? 'text-green' : 'text-red' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">{label}</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Positions */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Open Positions {detail?.positions.length ? <span className="text-accent">({detail.positions.length})</span> : ''}
          </div>
          {loading && <span className="text-[10px] text-muted animate-pulse">refreshing…</span>}
        </div>
        {!detail?.positions.length ? (
          <p className="text-[12px] text-muted">No open positions on this account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Size', 'Avg Price', 'Mark', 'uPnL', ''].map(h => (
                    <th key={h} className="pb-2 pr-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.positions.map((p, i) => {
                  const pnl = parseFloat(p.unrealisedPnl)
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-mono text-tx/90">{p.symbol}</td>
                      <td className={`py-2 pr-3 font-semibold ${p.side === 'Sell' ? 'text-red' : 'text-green'}`}>{p.side}</td>
                      <td className="py-2 pr-3 tabular-nums">{p.size}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{parseFloat(p.avgPrice).toFixed(2)}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{parseFloat(p.markPrice).toFixed(2)}</td>
                      <td className={`py-2 pr-3 font-mono tabular-nums font-semibold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>{fmt(pnl)}</td>
                      <td className="py-2">
                        <button
                          onClick={() => closePosition(p.symbol, p.side, p.size, p.account)}
                          disabled={!!closing}
                          className="text-[11px] px-2 py-1 rounded border border-red/50 text-red hover:bg-red/10 transition-colors disabled:opacity-40"
                        >
                          {closing === p.symbol ? '…' : `Close → ${closeSide(p.side)}`}
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

      {/* Open Orders */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">
          Open Orders {orders.length ? <span className="text-accent">({orders.length})</span> : ''}
        </div>
        {!orders.length ? (
          <p className="text-[12px] text-muted">No pending orders on this account.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Type', 'Qty', 'Price', 'Status', 'Placed', ''].map(h => (
                    <th key={h} className="pb-2 pr-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-mono text-tx/90">{o.symbol}</td>
                    <td className={`py-2 pr-3 font-semibold ${o.side === 'Sell' ? 'text-red' : 'text-green'}`}>{o.side}</td>
                    <td className="py-2 pr-3 text-muted">{o.orderType}</td>
                    <td className="py-2 pr-3 tabular-nums">{o.qty}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">{o.price || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue/10 text-blue border border-blue/30">{o.orderStatus}</span>
                    </td>
                    <td className="py-2 pr-3 text-muted">{parseTs(o.createdTime)}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution History */}
      <div className="bg-s1 border border-border rounded-card p-4">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Execution History (last 30)</div>
        {!execs.length ? (
          <p className="text-[12px] text-muted">No executions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Type', 'Qty', 'Fill Price', 'Closed PnL', 'Time'].map(h => (
                    <th key={h} className="pb-2 pr-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {execs.map((e, i) => {
                  const pnl = parseFloat(e.closedPnl)
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-tx/90">{e.symbol}</td>
                      <td className={`py-1.5 pr-3 font-semibold ${e.side === 'Sell' ? 'text-red' : 'text-green'}`}>{e.side}</td>
                      <td className="py-1.5 pr-3 text-muted">{e.orderType}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{e.execQty}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums text-accent">{parseFloat(e.execPrice).toFixed(2)}</td>
                      <td className={`py-1.5 pr-3 font-mono tabular-nums font-semibold ${pnl === 0 ? 'text-muted' : pnl > 0 ? 'text-green' : 'text-red'}`}>
                        {pnl === 0 ? '—' : fmt(pnl)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted">{parseTs(e.execTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
