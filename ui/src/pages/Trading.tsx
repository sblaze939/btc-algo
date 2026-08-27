import { useEffect, useRef, useState } from 'react'
import { api, Account, AccountDetail, Execution, MismatchAccount, OpenOrder, PlaceOrderInput, SymbolMatch } from '../api'

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
  const [accounts,   setAccounts]   = useState<Account[]>([])
  const [selIdx,     setSelIdx]     = useState(0)
  const [detail,     setDetail]     = useState<AccountDetail | null>(null)
  const [orders,     setOrders]     = useState<OpenOrder[]>([])
  const [execs,      setExecs]      = useState<Execution[]>([])
  const [totalPnl,   setTotalPnl]   = useState(0)
  const [loading,      setLoading]      = useState(false)
  const [initialLoad,  setInitialLoad]  = useState(true)
  const [closing,      setClosing]      = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [showOrder,  setShowOrder]  = useState(false)

  // Current expiry
  const [currentExpiry,    setCurrentExpiry]    = useState<string>('')
  const [editingExpiry,    setEditingExpiry]     = useState(false)
  const [expiryDraft,      setExpiryDraft]       = useState('')
  const [savingExpiry,     setSavingExpiry]      = useState(false)

  // Mismatch
  const [mismatches, setMismatches] = useState<MismatchAccount[]>([])
  const [syncing,    setSyncing]    = useState<string | null>(null)   // symbol being synced
  const [syncedSet,  setSyncedSet]  = useState<Set<string>>(new Set())

  // Account dropdown
  const [dropOpen,   setDropOpen]   = useState(false)
  const [dropSearch, setDropSearch] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.accounts.list().then(setAccounts).catch(() => {})
    api.mismatch.get().then(r => setMismatches(r.mismatches)).catch(() => {})
    api.settings.get().then(s => setCurrentExpiry(s.current_expiry || '')).catch(() => {})
  }, [])

  async function saveExpiry() {
    if (!expiryDraft) return
    setSavingExpiry(true)
    try {
      await api.settings.setExpiry(expiryDraft)
      setCurrentExpiry(expiryDraft)
      setEditingExpiry(false)
    } catch { /**/ } finally {
      setSavingExpiry(false)
    }
  }

  useEffect(() => {
    if (!accounts.length) return
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [selIdx, accounts])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
      setInitialLoad(false)
    }
  }

  async function syncPosition(accIdx: number, symbol: string, side: string, size: string) {
    setSyncing(symbol)
    try {
      const r = await api.mismatch.sync({ account_idx: accIdx, symbol, side, size })
      if (r.ok) {
        setSyncedSet(prev => new Set([...prev, `${accIdx}::${symbol}`]))
        // Refresh mismatch list
        api.mismatch.get().then(r2 => setMismatches(r2.mismatches)).catch(() => {})
      } else {
        alert(`Sync failed: ${r.error}`)
      }
    } catch (e: any) {
      alert(e.message ?? 'Sync failed')
    } finally {
      setSyncing(null)
    }
  }

  async function syncAll(acc: MismatchAccount) {
    for (const pos of acc.missing) {
      const key = `${acc.account_idx}::${pos.symbol}`
      if (syncedSet.has(key)) continue
      await syncPosition(acc.account_idx, pos.symbol, pos.side, pos.size)
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

  // Skeleton while waiting for first data fetch
  if (initialLoad) return (
    <div className="p-4 sm:p-6 space-y-4 animate-pulse">
      {/* Account bar */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-44 bg-s3 rounded-lg" />
        <div className="h-8 w-28 bg-s3 rounded-lg ml-auto" />
      </div>
      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="card p-4 space-y-3">
            <div className="h-2.5 w-20 bg-s3 rounded" />
            <div className="h-6 w-28 bg-s3 rounded" />
            <div className="h-2 w-16 bg-s3 rounded" />
          </div>
        ))}
      </div>
      {/* Margin bar */}
      <div className="card p-4 space-y-2">
        <div className="flex justify-between">
          <div className="h-2.5 w-32 bg-s3 rounded" />
          <div className="h-2.5 w-10 bg-s3 rounded" />
        </div>
        <div className="h-1.5 w-full bg-s3 rounded-full" />
        <div className="flex justify-between">
          <div className="h-2 w-24 bg-s3 rounded" />
          <div className="h-2 w-24 bg-s3 rounded" />
        </div>
      </div>
      {/* Positions table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><div className="h-3 w-32 bg-s3 rounded" /></div>
        {[1,2].map(r => (
          <div key={r} className="flex gap-6 px-4 py-3.5 border-b border-border last:border-0">
            <div className="h-3 w-40 bg-s3 rounded flex-1" />
            <div className="h-3 w-10 bg-s3 rounded" />
            <div className="h-3 w-16 bg-s3 rounded" />
            <div className="h-3 w-20 bg-s3 rounded" />
            <div className="h-6 w-16 bg-s3 rounded ml-auto" />
          </div>
        ))}
      </div>
      {/* Orders + Executions */}
      {[1,2].map(i => (
        <div key={i} className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border"><div className="h-3 w-28 bg-s3 rounded" /></div>
          <div className="flex gap-6 px-4 py-3.5">
            <div className="h-3 w-36 bg-s3 rounded flex-1" />
            <div className="h-3 w-16 bg-s3 rounded" />
            <div className="h-3 w-20 bg-s3 rounded" />
          </div>
        </div>
      ))}
    </div>
  )

  const acct = accounts[selIdx]
  const curMismatch = mismatches.find(m => m.account_idx === selIdx)
  const pendingMismatches = curMismatch?.missing.filter(
    p => !syncedSet.has(`${selIdx}::${p.symbol}`)
  ) ?? []
  const filteredAccounts = accounts.filter(a =>
    a.name.toLowerCase().includes(dropSearch.toLowerCase())
  )

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

      {/* Account selector + Place Order */}
      <div className="flex items-center gap-3">
        {/* Dropdown selector */}
        <div ref={dropRef} className="relative" style={{ maxWidth: 280 }}>
          <button
            onClick={() => { setDropOpen(o => !o); setDropSearch('') }}
            className={[
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors w-full',
              dropOpen ? 'border-accent text-tx' : 'border-border text-tx hover:border-accent/60',
              'bg-s1',
            ].join(' ')}
          >
            <span className="flex-1 text-left truncate">{acct?.name ?? '—'}</span>
            {acct?.is_master && (
              <span className="text-[9px] font-bold bg-accent/20 text-accent px-1.5 py-0.5 rounded">MASTER</span>
            )}
            {!acct?.is_master && pendingMismatches.length > 0 && (
              <span className="text-[9px] font-bold bg-yellow-400/20 text-yellow-400 px-1.5 py-0.5 rounded">
                ⚠ {pendingMismatches.length}
              </span>
            )}
            <span className="text-muted text-[10px]">{dropOpen ? '▲' : '▼'}</span>
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-s2 border border-border rounded-xl shadow-xl z-20 overflow-hidden">
              <input
                autoFocus
                value={dropSearch}
                onChange={e => setDropSearch(e.target.value)}
                placeholder="Search accounts…"
                className="w-full px-3 py-2 bg-s1 border-b border-border text-[12px] text-tx placeholder:text-muted outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {filteredAccounts.length === 0 && (
                  <div className="px-3 py-2 text-[12px] text-muted">No accounts found</div>
                )}
                {accounts.map((a, i) => {
                  if (!a.name.toLowerCase().includes(dropSearch.toLowerCase())) return null
                  const mm = mismatches.find(m => m.account_idx === i)
                  const hasMismatch = !a.is_master && (mm?.missing.filter(
                    p => !syncedSet.has(`${i}::${p.symbol}`)
                  ).length ?? 0) > 0
                  const posCount = i === selIdx ? detail?.positions.length ?? 0 : null
                  return (
                    <button
                      key={i}
                      onClick={() => { setSelIdx(i); setDropOpen(false) }}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-left transition-colors',
                        i === selIdx ? 'text-accent bg-accent/5' : 'text-muted hover:bg-s1 hover:text-tx',
                      ].join(' ')}
                    >
                      <span className={[
                        'w-1.5 h-1.5 rounded-full flex-shrink-0',
                        i === selIdx ? 'bg-accent' : hasMismatch ? 'bg-yellow-400' : 'bg-border',
                      ].join(' ')} />
                      <span className="flex-1 truncate">{a.name}</span>
                      {a.is_master && <span className="text-[8px] font-bold bg-accent/20 text-accent px-1 py-0.5 rounded">MASTER</span>}
                      {hasMismatch && <span className="text-[9px] text-yellow-400">⚠</span>}
                      {posCount !== null && posCount > 0 && (
                        <span className="text-[10px] text-muted">{posCount} pos</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Current Expiry chip */}
        <div className="flex items-center gap-1.5">
          {!editingExpiry ? (
            <button
              onClick={() => { setExpiryDraft(currentExpiry); setEditingExpiry(true) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-s1 hover:border-accent/60 transition-colors group"
              title="Click to change current expiry"
            >
              <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Expiry</span>
              <span className="text-[12px] font-mono font-bold text-accent">
                {currentExpiry
                  ? new Date(currentExpiry + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                  : '—'}
              </span>
              <span className="text-[10px] text-muted group-hover:text-accent transition-colors">✎</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                autoFocus
                value={expiryDraft}
                onChange={e => setExpiryDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveExpiry(); if (e.key === 'Escape') setEditingExpiry(false) }}
                className="bg-bg border border-accent rounded px-2 py-1 text-[12px] font-mono text-tx focus:outline-none"
              />
              <button
                onClick={saveExpiry}
                disabled={savingExpiry || !expiryDraft}
                className="px-2.5 py-1 rounded bg-accent text-bg text-[11px] font-bold hover:opacity-85 disabled:opacity-40 transition-opacity"
              >
                {savingExpiry ? '…' : 'Set'}
              </button>
              <button
                onClick={() => setEditingExpiry(false)}
                className="px-2 py-1 rounded border border-border text-muted text-[11px] hover:text-tx transition-colors"
              >
                ✕
              </button>
            </div>
          )}
        </div>

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
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Equity tile with delta vs wallet */}
            <div className="card p-4">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Equity</div>
              <div className="font-mono text-lg font-bold tabular-nums text-tx">
                {detail.wallet.equity.toFixed(2)} {detail.wallet.currency}
              </div>
              {(() => {
                const delta = detail.wallet.equity - detail.wallet.wallet_balance
                const pct   = detail.wallet.wallet_balance !== 0
                  ? Math.abs(delta / detail.wallet.wallet_balance * 100).toFixed(2)
                  : '0.00'
                if (Math.abs(delta) < 0.001) return (
                  <div className="text-[10px] text-muted mt-1.5 font-mono">= wallet balance</div>
                )
                const sign  = delta >= 0 ? '+' : '−'
                const color = delta >= 0 ? 'text-green' : 'text-red'
                return (
                  <div className={`text-[10px] font-mono tabular-nums mt-1.5 ${color}`}>
                    {sign}{Math.abs(delta).toFixed(2)} ({sign}{pct}%) vs wallet
                  </div>
                )
              })()}
            </div>

            <div className="card p-4">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Wallet Balance</div>
              <div className="font-mono text-lg font-bold tabular-nums text-tx">
                {detail.wallet.wallet_balance.toFixed(2)} {detail.wallet.currency}
              </div>
              <div className="text-[10px] text-muted mt-1.5">settled cash</div>
            </div>

            <div className="card p-4">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Unrealised PnL</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${detail.wallet.unrealised_pnl >= 0 ? 'text-green' : 'text-red'}`}>
                {fmt(detail.wallet.unrealised_pnl)} {detail.wallet.currency}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Realised PnL</div>
              <div className={`font-mono text-lg font-bold tabular-nums ${totalPnl >= 0 ? 'text-green' : 'text-red'}`}>
                {fmt(totalPnl)} USDT
              </div>
            </div>
          </div>

          {/* Margin utilisation */}
          {(detail.wallet.margin_rate !== undefined && detail.wallet.margin_rate !== null) && (() => {
            const rate     = detail.wallet.margin_rate ?? 0
            const pct      = Math.min(100, Math.round(rate * 100))
            const barColor = pct >= 80 ? 'bg-red' : pct >= 50 ? 'bg-yellow-400' : 'bg-green'
            return (
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">Margin Utilisation</div>
                  <div className={`font-mono text-[13px] font-bold tabular-nums ${pct >= 80 ? 'text-red' : pct >= 50 ? 'text-yellow-400' : 'text-green'}`}>{pct}%</div>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted mt-1.5 tabular-nums">
                  <span>Used: {(detail.wallet.margin_used ?? 0).toFixed(2)} {detail.wallet.currency}</span>
                  <span>Free: {(detail.wallet.available ?? 0).toFixed(2)} {detail.wallet.currency}</span>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* Mismatch banner — shown for child accounts that are missing master positions */}
      {pendingMismatches.length > 0 && (
        <div className="border border-yellow-400/30 bg-yellow-400/5 rounded-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-yellow-400 flex items-center gap-2">
              ⚠ Position Mismatch —
              {pendingMismatches.length} position{pendingMismatches.length > 1 ? 's' : ''} missing vs master
            </div>
            <button
              onClick={() => syncAll(curMismatch!)}
              disabled={!!syncing}
              className="text-[11px] px-3 py-1 rounded border border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-40"
            >
              {syncing ? 'Syncing…' : 'Sync All Missing'}
            </button>
          </div>
          <div className="space-y-2">
            {pendingMismatches.map(pos => {
              const key = `${selIdx}::${pos.symbol}`
              const isSyncing = syncing === pos.symbol
              const isSynced  = syncedSet.has(key)
              return (
                <div key={pos.symbol} className="flex items-center gap-3 text-[12px] border-t border-yellow-400/10 pt-2">
                  <span className="font-mono text-tx/80 flex-1">{pos.symbol}</span>
                  <span className="text-red font-semibold">{pos.side}</span>
                  <span className="text-muted tabular-nums">{pos.size} BTC</span>
                  {isSynced ? (
                    <span className="text-green text-[11px] font-semibold">✓ Synced</span>
                  ) : (
                    <button
                      onClick={() => syncPosition(selIdx, pos.symbol, pos.side, pos.size)}
                      disabled={!!syncing}
                      className="text-[11px] px-2 py-0.5 rounded border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-40"
                    >
                      {isSyncing ? '…' : 'Sync →'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
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
                      <td className="py-2 pr-3 font-mono text-tx/90">
                        {p.symbol}
                        {p.manual && <span className="ml-1.5 text-[9px] font-bold bg-accent/20 text-accent px-1 py-0.5 rounded uppercase tracking-wide">Manual</span>}
                      </td>
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
                  const pnlValid = !isNaN(pnl) && pnl !== 0
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-tx/90">{e.symbol}</td>
                      <td className={`py-1.5 pr-3 font-semibold ${e.side === 'Sell' ? 'text-red' : 'text-green'}`}>{e.side}</td>
                      <td className="py-1.5 pr-3 text-muted">{e.orderType}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{e.execQty}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums text-accent">{parseFloat(e.execPrice).toFixed(2)}</td>
                      <td className={`py-1.5 pr-3 font-mono tabular-nums font-semibold ${pnlValid ? (pnl > 0 ? 'text-green' : 'text-red') : 'text-muted'}`}>
                        {pnlValid ? fmt(pnl) : '—'}
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
