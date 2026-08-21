import { useState, useEffect, useRef, useCallback } from 'react'
import { api, Account, WalletBalance, Position, ExecutionRecord, Instrument } from '../api'

function fmt(n: number, dec = 2) {
  return (n >= 0 ? '+' : '') + n.toFixed(dec)
}
function closeSide(side: string) { return side === 'Sell' ? 'Buy' : 'Sell' }
function marginColor(pct: number) {
  return pct >= 80 ? 'text-red' : pct >= 50 ? 'text-yellow-400' : 'text-green'
}
function marginBg(pct: number) {
  return pct >= 80 ? 'bg-red' : pct >= 50 ? 'bg-yellow-400' : 'bg-green'
}
function marginPillCls(pct: number) {
  if (pct >= 80) return 'bg-red/15 text-red'
  if (pct >= 50) return 'bg-yellow-400/15 text-yellow-400'
  return 'bg-green/15 text-green'
}

// ── Instrument expiry formatter ───────────────────────────────────────────────
function fmtExpiry(tsMs: string): string {
  if (!tsMs) return ''
  const d = new Date(Number(tsMs))
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── Place Order Modal (smart symbol picker) ──────────────────────────────────
function PlaceOrderModal({ accountName, onClose, onDone, instruments }: {
  accountName: string; onClose: () => void; onDone: () => void
  instruments: Instrument[]
}) {
  const [strike, setStrike]       = useState('')
  const [optType, setOptType]     = useState<'Put' | 'Call'>('Put')
  const [symbol, setSymbol]       = useState('')
  const [side, setSide]           = useState<'Buy' | 'Sell'>('Sell')
  const [qty, setQty]             = useState('0.01')
  const [orderType, setOrderType] = useState<'Market' | 'Limit'>('Market')
  const [price, setPrice]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [err, setErr]             = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Filter instruments: strike contains typed text + type matches; all expiries shown
  const matches = instruments.filter(i => {
    const strikeMatch = !strike || i.strike.includes(strike)
    const typeMatch   = i.type === optType
    return strikeMatch && typeMatch
  }).sort((a, b) => Number(a.expiry) - Number(b.expiry)).slice(0, 20)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  async function submit() {
    const finalSymbol = symbol.trim() || (matches.length === 1 ? matches[0].symbol : '')
    if (!finalSymbol) { setErr('Select a symbol'); return }
    if (orderType === 'Limit' && !price.trim()) { setErr('Price required for Limit order'); return }
    setLoading(true); setErr('')
    try {
      await api.portfolio.placeOrder({
        symbol: finalSymbol.toUpperCase(),
        side, qty: qty.trim(),
        order_type: orderType,
        price: orderType === 'Limit' ? price.trim() : undefined,
        account: accountName,
      })
      onDone(); onClose()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Order failed') }
    finally { setLoading(false) }
  }

  const finalSymbol = symbol || (matches.length === 1 ? matches[0].symbol : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="bg-s1 border border-border rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Place Order · <span className="text-accent">{accountName}</span></h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">&times;</button>
        </div>

        {/* Symbol picker */}
        <div className="space-y-2">
          <label className="text-[10px] text-muted uppercase tracking-wider block">Symbol</label>
          {instruments.length > 0 ? (
            <>
              {/* Strike + CE/PE row */}
              <div className="flex gap-2">
                <input className="input font-mono text-xs flex-1" placeholder="Strike (e.g. 64500)"
                  value={strike} onChange={e => { setStrike(e.target.value); setSymbol('') }} />
                <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
                  {(['Put', 'Call'] as const).map(t => (
                    <button key={t} onClick={() => { setOptType(t); setSymbol('') }}
                      className={`px-3 py-1 text-xs font-semibold transition-colors ${optType === t ? 'bg-accent/20 text-accent' : 'bg-s2 text-muted hover:text-tx'}`}>
                      {t === 'Put' ? 'PE' : 'CE'}
                    </button>
                  ))}
                </div>
              </div>
              {/* Results dropdown — shown when strike typed */}
              {strike && (
                <div className="max-h-36 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {matches.length === 0
                    ? <p className="text-[11px] text-muted p-2 text-center">No matches for {strike}</p>
                    : matches.map(i => (
                      <button key={i.symbol} onClick={() => setSymbol(i.symbol)}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${symbol === i.symbol ? 'bg-accent/15 text-accent' : 'hover:bg-s2 text-tx'}`}>
                        {i.symbol}
                      </button>
                    ))
                  }
                </div>
              )}
              {finalSymbol && (
                <p className="text-[10px] text-muted font-mono truncate">→ {finalSymbol}</p>
              )}
            </>
          ) : (
            <input className="input font-mono text-xs w-full" placeholder="BTC-28AUG26-64000-P-USDT"
              value={symbol} onChange={e => setSymbol(e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Side</label>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(['Sell', 'Buy'] as const).map(s => (
                <button key={s} onClick={() => setSide(s)}
                  className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${side === s ? (s === 'Sell' ? 'bg-red text-white' : 'bg-green text-bg') : 'bg-s2 text-muted hover:text-tx'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Qty (lots)</label>
            <input className="input font-mono text-xs w-full" placeholder="0.01"
              value={qty} onChange={e => setQty(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Order Type</label>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(['Market', 'Limit'] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)}
                  className={`flex-1 py-1.5 text-sm font-semibold transition-colors ${orderType === t ? 'bg-accent text-bg' : 'bg-s2 text-muted hover:text-tx'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          {orderType === 'Limit' && (
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Price</label>
              <input className="input font-mono text-xs w-full" placeholder="25.00"
                value={price} onChange={e => setPrice(e.target.value)} />
            </div>
          )}
        </div>
        {err && <p className="text-red text-[12px]">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={loading}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 ${side === 'Sell' ? 'bg-red text-white hover:bg-red/80' : 'bg-green text-bg hover:bg-green/80'}`}>
            {loading ? 'Placing…' : `${side} ${qty || '?'} lots`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Per-account summary for dropdown ─────────────────────────────────────────
interface AccSummary {
  marginPct: number
  posCount: number
  posSymbols: Set<string>
}

// ── Main Trading Page ────────────────────────────────────────────────────────

export default function Trading() {
  const [accounts, setAccounts]             = useState<Account[]>([])
  const [selIdx, setSelIdx]                 = useState<number>(0)
  const [wallet, setWallet]                 = useState<WalletBalance | null>(null)
  const [positions, setPositions]           = useState<Position[]>([])
  const [masterPositions, setMasterPositions] = useState<Position[]>([])
  const [orders, setOrders]                 = useState<unknown[]>([])
  const [executions, setExecutions]         = useState<ExecutionRecord[]>([])
  const [realisedPnl, setRealisedPnl]       = useState(0)
  const [loading, setLoading]               = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const firstLoadDone                       = useRef(false)
  const [err, setErr]                       = useState('')
  const [closing, setClosing]               = useState<string | null>(null)
  const [showPlace, setShowPlace]           = useState(false)
  const [dropdownOpen, setDropdownOpen]     = useState(false)
  const [searchQ, setSearchQ]               = useState('')
  const [syncing, setSyncing]               = useState<string | null>(null)
  const [accSummaries, setAccSummaries]     = useState<Record<string, AccSummary>>({})
  const [instruments, setInstruments]       = useState<Instrument[]>([])
  const dropRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Load master positions for mismatch detection
  async function loadMasterSummary() {
    try {
      const [w, r] = await Promise.all([api.portfolio.balance(), api.portfolio.positions()])
      const mpos = r.positions.filter(p => p.account === 'master')
      setMasterPositions(mpos)
      setAccSummaries(prev => ({
        ...prev,
        master: {
          marginPct: Math.round((w.margin_rate ?? 0) * 100),
          posCount: mpos.length,
          posSymbols: new Set(mpos.map(p => p.symbol)),
        },
      }))
    } catch { /**/ }
  }

  // Background-load all sub-account summaries for dropdown
  // An account is "master" if it has no separate API key (uses master env keys)
  function isMasterAccount(idx: number) { return !accounts[idx]?.api_key_masked }

  async function loadSubSummaries(accs: Account[]) {
    accs.forEach((_, i) => {
      api.accounts.detail(i).then(d => {
        setAccSummaries(prev => ({
          ...prev,
          [i]: {
            marginPct: Math.round((d.wallet.margin_rate ?? 0) * 100),
            posCount: d.positions.length,
            posSymbols: new Set(d.positions.map(p => p.symbol)),
          },
        }))
      }).catch(() => { /**/ })
    })
  }

  useEffect(() => {
    api.accounts.list().then(a => {
      setAccounts(a)
      loadSubSummaries(a)
    }).catch(() => {})
    loadMasterSummary()
    // Load instruments for symbol picker (non-blocking)
    api.instruments.list().then(setInstruments).catch(() => {})
  }, [])

  const load = useCallback(async (idx: number) => {
    setLoading(true); setErr('')
    setWallet(null); setPositions([]); setOrders([]); setExecutions([]); setRealisedPnl(0)
    try {
      const d = await api.accounts.detail(idx)
      setWallet(d.wallet)
      setPositions(d.positions)
      // If this account has no separate API key it IS master — update masterPositions too
      if (!accounts[idx]?.api_key_masked) {
        setMasterPositions(d.positions)
      }
      setAccSummaries(prev => ({
        ...prev,
        [idx]: {
          marginPct: Math.round((d.wallet.margin_rate ?? 0) * 100),
          posCount: d.positions.length,
          posSymbols: new Set(d.positions.map(p => p.symbol)),
        },
      }))
      try {
        const o = await api.accounts.orders(idx)
        setOrders((o as { orders: unknown[] }).orders ?? [])
      } catch { /**/ }
      try {
        const ex = await api.accounts.executions(idx)
        setRealisedPnl(ex.total_realised_pnl ?? 0)
        setExecutions(ex.executions.slice(0, 30))
      } catch { /**/ }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load account data')
    } finally {
      setLoading(false)
      if (!firstLoadDone.current) { firstLoadDone.current = true; setInitialLoading(false) }
    }
  }, [accounts])

  useEffect(() => {
    load(selIdx)
    const id = setInterval(() => load(selIdx), 30_000)
    return () => clearInterval(id)
  }, [selIdx, load])

  async function closePosition(p: Position) {
    setClosing(p.symbol)
    try {
      await api.portfolio.close({ symbol: p.symbol, side: p.side, size: p.size, account: p.account })
      await load(selIdx)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Close failed') }
    finally { setClosing(null) }
  }

  // Mismatch: master positions missing from current sub-account
  const isMaster = isMasterAccount(selIdx)
  const curSymbols = new Set(positions.map(p => p.symbol))
  const mismatches = isMaster ? [] : masterPositions.filter(mp => !curSymbols.has(mp.symbol))

  async function syncOne(mp: Position) {
    setSyncing(mp.symbol)
    try {
      await api.portfolio.placeOrder({
        symbol: mp.symbol,
        side: mp.side,
        qty: mp.size,
        order_type: 'Market',
        account: accountName,
      })
      await load(selIdx)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Sync failed') }
    finally { setSyncing(null) }
  }

  async function syncAll() {
    for (const mp of mismatches) {
      await syncOne(mp)
    }
  }

  const cur = wallet?.currency === 'INR' ? '₹' : '$'
  const marginPct  = wallet ? Math.round((wallet.margin_rate ?? 0) * 100) : 0
  const marginUsed = wallet ? wallet.margin_used ?? 0 : 0
  const available  = wallet ? wallet.available ?? 0 : 0
  const equityDelta = wallet ? wallet.equity - wallet.wallet_balance : 0

  const accountName = accounts[selIdx]?.name ?? 'master'

  // Dropdown account list — no hardcoded Master entry; Sblaze (no separate key) IS master
  const allOptions: { label: string; value: number; isMaster: boolean }[] = accounts.map((a, i) => ({
    label: a.name,
    value: i,
    isMaster: !a.api_key_masked,
  }))
  const filtered = allOptions.filter(o => o.label.toLowerCase().includes(searchQ.toLowerCase()))
  const selectedLabel = accounts[selIdx]?.name ?? 'Account'

  function selectAccount(idx: number) {
    setSelIdx(idx)
    setDropdownOpen(false)
    setSearchQ('')
  }

  function getMismatchCount(val: number): number {
    const summary = accSummaries[val]
    if (!summary || isMasterAccount(val)) return 0
    const masterSummary = accSummaries['master']
    if (!masterSummary) return 0
    let count = 0
    masterSummary.posSymbols.forEach(sym => {
      if (!summary.posSymbols.has(sym)) count++
    })
    return count
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {showPlace && (
        <PlaceOrderModal
          accountName={accountName}
          onClose={() => setShowPlace(false)}
          onDone={() => load(selIdx)}
          instruments={instruments}
        />
      )}

      {/* Header — rich account dropdown + Place Order */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold shrink-0">Trading</h1>
          {/* Current expiry badge */}
          {instruments.length > 0 && (() => {
            const now = Date.now()
            const nearest = instruments
              .map(i => Number(i.expiry))
              .filter(ts => ts > now)
              .sort((a, b) => a - b)[0]
            if (!nearest) return null
            const label = new Date(nearest).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
            return (
              <span className="text-[10px] font-medium bg-accent/10 text-accent border border-accent/20 rounded-full px-2.5 py-0.5 shrink-0">
                Expiry: {label}
              </span>
            )
          })()}

          {/* Rich dropdown */}
          <div ref={dropRef} className="relative">
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className="flex items-center gap-2 bg-s2 border border-border rounded-lg pl-3 pr-2.5 py-1.5 text-sm font-semibold hover:border-accent/50 transition-colors focus:outline-none min-w-[160px]"
            >
              <span className="flex-1 text-left">{selectedLabel}</span>
              {isMasterAccount(selIdx) && (
                <span className="text-[9px] font-bold bg-accent/20 text-accent px-1.5 py-0.5 rounded shrink-0">MASTER</span>
              )}
              {getMismatchCount(selIdx) > 0 && (
                <span className="text-[9px] font-bold text-yellow-400 shrink-0">⚠</span>
              )}
              {(() => {
                const s = accSummaries[selIdx]
                return s ? (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0 ${marginPillCls(s.marginPct)}`}>
                    {s.marginPct}%
                  </span>
                ) : null
              })()}
              <span className="text-muted text-[10px] ml-0.5">▾</span>
            </button>

            {dropdownOpen && (
              <div className="absolute top-full mt-1 left-0 w-72 bg-s2 border border-border rounded-xl shadow-2xl z-30 overflow-hidden">
                <div className="p-2 border-b border-border">
                  <input
                    autoFocus
                    className="w-full bg-s1 border border-border rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:border-accent/50 placeholder:text-muted"
                    placeholder="Search accounts…"
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {filtered.map(o => {
                    const key = o.value === -1 ? 'master' : o.value
                    const s = accSummaries[key as string | number]
                    const mm = getMismatchCount(o.value)
                    return (
                      <button
                        key={o.value}
                        onClick={() => selectAccount(o.value)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold hover:bg-s1 transition-colors ${o.value === selIdx ? 'text-accent' : 'text-tx'}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.value === selIdx ? 'bg-accent' : mm > 0 ? 'bg-yellow-400' : 'bg-border'}`} />
                        <span className="flex-1">{o.label}</span>
                        {o.isMaster && (
                          <span className="text-[8px] font-bold bg-accent/15 text-accent px-1 py-0.5 rounded">MASTER</span>
                        )}
                        {mm > 0 && (
                          <span className="text-[9px] text-yellow-400 font-semibold">⚠ {mm} missing</span>
                        )}
                        {s && (
                          <>
                            <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${marginPillCls(s.marginPct)}`}>
                              {s.marginPct}%
                            </span>
                            <span className="text-[10px] text-muted">
                              {s.posCount > 0 ? `${s.posCount} pos` : 'no pos'}
                            </span>
                          </>
                        )}
                      </button>
                    )
                  })}
                  {filtered.length === 0 && (
                    <div className="px-3 py-4 text-[12px] text-muted text-center">No accounts found</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {loading && <span className="text-[11px] text-muted animate-pulse shrink-0">Refreshing…</span>}
        </div>

        <button
          onClick={() => setShowPlace(true)}
          className="px-4 py-1.5 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-colors text-sm font-semibold shrink-0"
        >
          + Place Order
        </button>
      </div>

      {err && <p className="text-red text-[12px]">{err}</p>}

      {/* 4 KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Equity</div>
          <div className="font-mono text-xl font-bold tabular-nums text-tx">
            {initialLoading ? <div className="h-7 w-28 rounded bg-white/5 animate-pulse" /> : wallet ? `${cur}${wallet.equity.toFixed(2)}` : '—'}
          </div>
          {!initialLoading && wallet && (
            <div className={`text-[10px] mt-1 font-mono ${equityDelta >= 0 ? 'text-green' : 'text-red'}`}>
              {equityDelta >= 0 ? '+' : ''}{equityDelta.toFixed(2)} {wallet.currency}
            </div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Wallet Balance</div>
          <div className="font-mono text-xl font-bold tabular-nums text-tx">
            {initialLoading ? <div className="h-7 w-28 rounded bg-white/5 animate-pulse" /> : wallet ? `${cur}${wallet.wallet_balance.toFixed(2)}` : '—'}
          </div>
          <div className="text-[10px] text-muted mt-1">settled cash</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Unrealised PnL</div>
          <div className={`font-mono text-xl font-bold tabular-nums ${wallet ? (wallet.unrealised_pnl >= 0 ? 'text-green' : 'text-red') : 'text-tx'}`}>
            {initialLoading ? <div className="h-7 w-28 rounded bg-white/5 animate-pulse" /> : wallet ? `${fmt(wallet.unrealised_pnl)} ${wallet.currency}` : '—'}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Realised PnL</div>
          <div className={`font-mono text-xl font-bold tabular-nums ${realisedPnl >= 0 ? 'text-green' : 'text-red'}`}>
            {initialLoading ? <div className="h-7 w-28 rounded bg-white/5 animate-pulse" /> : wallet ? `${fmt(realisedPnl)} ${wallet.currency}` : '—'}
          </div>
        </div>
      </div>

      {/* Mismatch Banner */}
      {!isMaster && mismatches.length > 0 && (
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-yellow-400 font-bold text-[12px]">
              <span>⚠</span>
              <span>Position Mismatch — {mismatches.length} position{mismatches.length > 1 ? 's' : ''} missing vs master</span>
            </div>
            <button
              onClick={syncAll}
              disabled={!!syncing}
              className="text-[11px] px-3 py-1 rounded-lg border border-yellow-500/40 text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-40 font-semibold"
            >
              {syncing ? 'Syncing…' : 'Sync All'}
            </button>
          </div>
          <div className="space-y-2">
            {mismatches.map(mp => (
              <div key={mp.symbol} className="flex items-center gap-3 py-1.5 border-b border-yellow-500/10 last:border-0 last:pb-0">
                <span className="font-mono text-[11px] text-tx flex-1">{mp.symbol}</span>
                <span className={`text-[11px] font-semibold ${mp.side === 'Sell' ? 'text-red' : 'text-green'}`}>{mp.side}</span>
                <span className="font-mono text-[11px] text-muted">{mp.size} BTC</span>
                <button
                  onClick={() => syncOne(mp)}
                  disabled={syncing === mp.symbol}
                  className="text-[11px] px-2.5 py-0.5 rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-40"
                >
                  {syncing === mp.symbol ? '…' : 'Sync →'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Margin Utilisation */}
      {wallet && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-widest">Margin Utilisation</div>
            <div className={`text-sm font-bold tabular-nums font-mono ${marginColor(marginPct)}`}>
              {marginPct}%
            </div>
          </div>
          <div className="h-2 bg-s2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${marginBg(marginPct)}`}
              style={{ width: `${Math.min(marginPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-muted font-mono">
            <span>Used: {cur}{marginUsed.toFixed(2)} {wallet.currency}</span>
            <span>Free: {cur}{available.toFixed(2)} {wallet.currency}</span>
          </div>
        </div>
      )}

      {/* Open Positions */}
      <div className="card p-4">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">
          Open Positions ({positions.length})
        </div>
        {initialLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>
        ) : positions.length === 0 ? (
          <p className="text-muted text-[12px]">No open positions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Size', 'Avg Price', 'Mark', 'uPnL', ''].map(h => (
                    <th key={h} className="pb-2 font-semibold pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const pnl = parseFloat(p.unrealisedPnl)
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[11px] text-tx/90">{p.symbol}</td>
                      <td className={`py-2 pr-4 font-semibold ${p.side === 'Sell' ? 'text-red' : 'text-green'}`}>{p.side}</td>
                      <td className="py-2 pr-4 tabular-nums">{p.size}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums">{parseFloat(p.avgPrice).toFixed(2)}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums">{parseFloat(p.markPrice).toFixed(2)}</td>
                      <td className={`py-2 pr-4 font-mono tabular-nums font-semibold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {fmt(pnl, 4)}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => closePosition(p)}
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
      <div className="card p-4">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Open Orders</div>
        {initialLoading ? (
          <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>
        ) : orders.length === 0 ? (
          <p className="text-muted text-[12px]">No pending orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Qty', 'Price', 'Type', 'Status'].map(h => (
                    <th key={h} className="pb-2 font-semibold pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(orders as Record<string, string>[]).map((o, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[11px]">{o.symbol}</td>
                    <td className={`py-2 pr-4 font-semibold ${o.side === 'Sell' ? 'text-red' : 'text-green'}`}>{o.side}</td>
                    <td className="py-2 pr-4">{o.qty}</td>
                    <td className="py-2 pr-4 font-mono">{o.price || 'Market'}</td>
                    <td className="py-2 pr-4 text-muted">{o.orderType}</td>
                    <td className="py-2 pr-4 text-muted">{o.orderStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution History */}
      <div className="card p-4">
        <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">
          Execution History (last 30)
        </div>
        {initialLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />)}</div>
        ) : executions.length === 0 ? (
          <p className="text-muted text-[12px]">No execution history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  {['Symbol', 'Side', 'Type', 'Qty', 'Fill Price', 'Closed PnL', 'Time'].map(h => (
                    <th key={h} className="pb-2 font-semibold pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {executions.map((e, i) => {
                  const pnl = parseFloat(e.closedPnl ?? '0')
                  const hasPnl = !isNaN(pnl) && pnl !== 0
                  return (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[11px] text-tx/90">{e.symbol}</td>
                      <td className={`py-2 pr-4 font-semibold ${e.side === 'Sell' ? 'text-red' : 'text-green'}`}>{e.side}</td>
                      <td className="py-2 pr-4 text-muted">{e.orderType}</td>
                      <td className="py-2 pr-4 font-mono">{e.execQty}</td>
                      <td className="py-2 pr-4 font-mono text-accent">{parseFloat(e.execPrice).toFixed(2)}</td>
                      <td className={`py-2 pr-4 font-mono font-semibold ${hasPnl ? (pnl > 0 ? 'text-green' : 'text-red') : 'text-muted'}`}>
                        {hasPnl ? fmt(pnl) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-muted text-[11px]">{e.execTime}</td>
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
