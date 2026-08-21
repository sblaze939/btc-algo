import { useState, useEffect, useRef, Fragment } from 'react'
import { api, Account, AccountInput, AccountDetail } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_INR  = 50_000
const BASE_USDT = 530   // ≈₹50,000 at ₹94/USDT

function roundMult(x: number): number {
  if (x <= 1) return 1
  const whole = Math.floor(x)
  const frac  = x - whole
  return frac < 0.5 ? whole : whole + 0.5
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

function ExpiryCell({ expires }: { expires?: string | null }) {
  if (!expires) return <span className="text-muted2 text-[12px]">— master key</span>
  const days = daysUntil(expires)
  if (days <= 0) return <span className="font-mono text-[11px] text-red font-semibold">Expired</span>
  const cls = days < 7 ? 'text-red font-semibold' : days < 14 ? 'text-yellow-400' : 'text-green'
  return <span className={`font-mono text-[11px] ${cls}`}>{days}d</span>
}

// ── Fund Transfer Modal ───────────────────────────────────────────────────────

function FundTransferModal({ accountIdx, accountName, onClose }: {
  accountIdx: number | null
  accountName: string
  onClose: () => void
}) {
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN')
  const [amount, setAmount]       = useState('')
  const [loading, setLoading]     = useState(false)
  const [err, setErr]             = useState('')
  const [success, setSuccess]     = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  async function submit() {
    const amt = parseFloat(amount)
    if (!amount || isNaN(amt) || amt <= 0) { setErr('Enter a valid amount'); return }
    setLoading(true); setErr(''); setSuccess('')
    try {
      if (accountIdx === null) {
        await api.funds.transferMaster(amt, direction)
      } else {
        await api.funds.transferAccount(accountIdx, amt, direction)
      }
      setSuccess(`Transfer of ₹${amt.toLocaleString()} ${direction === 'IN' ? 'to Bybit' : 'to CoinSwitch'} initiated.`)
      setAmount('')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Transfer failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="bg-s1 border border-border rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base">Fund Transfer · <span className="text-accent">{accountName}</span></h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">&times;</button>
        </div>

        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">Direction</label>
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button
              onClick={() => setDirection('IN')}
              className={`flex-1 py-2 text-[12px] font-semibold transition-colors ${direction === 'IN' ? 'bg-accent text-bg' : 'bg-s2 text-muted hover:text-tx'}`}
            >
              IN — CoinSwitch → Bybit
            </button>
            <button
              onClick={() => setDirection('OUT')}
              className={`flex-1 py-2 text-[12px] font-semibold transition-colors ${direction === 'OUT' ? 'bg-accent text-bg' : 'bg-s2 text-muted hover:text-tx'}`}
            >
              OUT — Bybit → CoinSwitch
            </button>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Amount (INR)</label>
          <input
            className="input font-mono w-full"
            type="number"
            min="1"
            step="100"
            placeholder="e.g. 5000"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>

        {err     && <p className="text-red text-[12px]">{err}</p>}
        {success && <p className="text-green text-[12px]">{success}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={submit} disabled={loading} className="btn-accent">
            {loading ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Account Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  account: (Account & { idx: number }) | null
  onClose: () => void
  onSave: () => void
}

function AccountModal({ account, onClose, onSave }: ModalProps) {
  const isEdit = account !== null
  const [form, setForm] = useState<AccountInput>({
    name: account?.name ?? '',
    account_size: account?.account_size ?? 50000,
    active: account?.active ?? true,
    api_key: '',
    api_secret: '',
    lot_multiplier: (account as any)?.lot_multiplier ?? null,
  })
  const [useCustomMult, setUseCustomMult] = useState(!!(account as any)?.lot_multiplier)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const mult = roundMult(form.account_size / BASE_INR).toFixed(1)
  const exampleLots = Math.floor(5 * roundMult(form.account_size / BASE_INR))

  async function save() {
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr('')
    try {
      if (isEdit) await api.accounts.update(account!.idx, form)
      else        await api.accounts.add(form)
      onSave()
      onClose()
    } catch (e: any) {
      setErr(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-s1 border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-5">{isEdit ? `Edit ${account!.name}` : 'Add Account'}</h2>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted font-semibold uppercase tracking-wider block mb-1">Name</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Satvik, Dad, Friend…" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted font-semibold uppercase tracking-wider">Lot Multiplier</label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={useCustomMult}
                  onChange={e => {
                    setUseCustomMult(e.target.checked)
                    setForm(f => ({ ...f, lot_multiplier: e.target.checked ? 1 : null }))
                  }}
                  className="w-3 h-3"
                />
                Override manually
              </label>
            </div>
            {useCustomMult ? (
              <input
                className="input font-mono"
                type="number"
                step="0.5"
                min="1"
                value={form.lot_multiplier ?? ''}
                onChange={e => setForm(f => ({ ...f, lot_multiplier: parseFloat(e.target.value) || null }))}
                placeholder="e.g. 2.5"
              />
            ) : (
              <div className="badge-data py-2 block text-center text-[11px]">
                Auto — computed from live wallet balance ÷ ₹50,000 (USDT: ÷ $530)
                &nbsp;→&nbsp;<strong>{mult}×</strong> · 5 mentor lots → <strong>{exampleLots} lots</strong>
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted font-semibold uppercase tracking-wider block mb-1">
              API Key {isEdit && <span className="normal-case font-normal">(leave blank to keep existing)</span>}
            </label>
            <input className="input font-mono text-xs" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder={isEdit ? '(unchanged)' : 'Optional — blank = master key'} />
          </div>
          <div>
            <label className="text-[11px] text-muted font-semibold uppercase tracking-wider block mb-1">API Secret</label>
            <input className="input font-mono text-xs" type="password" value={form.api_secret} onChange={e => setForm(f => ({ ...f, api_secret: e.target.value }))} placeholder={isEdit ? '(unchanged)' : 'Optional'} />
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-semibold">Active</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              <div className="w-10 h-6 bg-s3 rounded-full peer-checked:bg-green transition-colors" />
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-4 shadow" />
            </label>
          </div>
        </div>

        {err && <p className="text-red text-sm mt-3">{err}</p>}

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-accent">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Place Order Modal ─────────────────────────────────────────────────────────

function AccPlaceOrder({ accountName, onClose, onPlaced }: { accountName: string; onClose: () => void; onPlaced: () => void }) {
  const [symbol, setSymbol]         = useState('')
  const [side, setSide]             = useState<'Buy' | 'Sell'>('Sell')
  const [qty, setQty]               = useState('0.01')
  const [orderType, setOrderType]   = useState<'Market' | 'Limit'>('Market')
  const [price, setPrice]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [err, setErr]               = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  async function submit() {
    if (!symbol.trim()) { setErr('Symbol required'); return }
    if (orderType === 'Limit' && !price.trim()) { setErr('Price required for Limit order'); return }
    setLoading(true); setErr('')
    try {
      await api.portfolio.placeOrder({
        symbol: symbol.trim().toUpperCase(),
        side,
        qty: qty.trim(),
        order_type: orderType,
        price: orderType === 'Limit' ? price.trim() : undefined,
        account: accountName,
      })
      onPlaced(); onClose()
    } catch (e: any) {
      setErr(e.message ?? 'Order failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} className="bg-s1 border border-border rounded-xl p-5 w-full max-w-sm shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Place Order · {accountName}</h3>
          <button onClick={onClose} className="text-muted hover:text-tx text-xl leading-none">&times;</button>
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Symbol</label>
          <input className="input font-mono text-xs w-full" placeholder="BTC-28AUG26-64000-P-USDT"
            value={symbol} onChange={e => setSymbol(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
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
        <div className="grid grid-cols-2 gap-2">
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
        {err && <p className="text-red text-[11px]">{err}</p>}
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

// ── Account Detail Panel ──────────────────────────────────────────────────────

function AccDetailPanel({ idx, onClose }: { idx: number; onClose: () => void }) {
  const [detail, setDetail]         = useState<AccountDetail | null>(null)
  const [orders, setOrders]         = useState<any[]>([])
  const [realisedPnl, setRealisedPnl] = useState<number>(0)
  const [err, setErr]               = useState('')
  const [closing, setClosing]       = useState<string | null>(null)
  const [showPlace, setShowPlace]   = useState(false)

  async function load() {
    try {
      const d = await api.accounts.detail(idx)
      setDetail(d)
    } catch (e: any) { setErr(e.message ?? 'API error') }
    try {
      const o = await (api as any).accounts.orders(idx)
      setOrders(o.orders ?? [])
    } catch { /**/ }
    try {
      const ex = await (api as any).accounts.executions(idx)
      setRealisedPnl(ex.total_realised_pnl ?? 0)
    } catch { /**/ }
  }

  useEffect(() => { load() }, [idx])

  async function closePos(symbol: string, side: string, size: string, account: string) {
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

  const w = detail?.wallet
  const cur = w?.currency === 'INR' ? '₹' : '$'
  const marginPct  = w ? Math.round((w as any).margin_rate * 100) : 0
  const marginUsed = w ? (w as any).margin_used ?? 0 : 0
  const available  = w ? (w as any).available ?? 0 : 0

  return (
    <tr>
      <td colSpan={7} className="px-4 pb-4 pt-0">
        <div className="bg-bg border border-border2 rounded-xl p-4 space-y-3">
          {err && <p className="text-red text-[12px]">{err}</p>}
          {!detail && !err && <p className="text-muted text-[12px]">Fetching from API…</p>}
          {detail && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Equity',         value: `${cur}${w!.equity.toFixed(2)}`,                sub: 'USDT' },
                  { label: 'Wallet Balance', value: `${cur}${w!.wallet_balance.toFixed(2)}`,        sub: 'settled cash' },
                  { label: 'Unrealised PnL', value: `${w!.unrealised_pnl >= 0 ? '+' : ''}${w!.unrealised_pnl.toFixed(2)} ${w!.currency}`, color: w!.unrealised_pnl >= 0 ? 'text-green' : 'text-red' },
                  { label: 'Realised PnL',   value: `${realisedPnl >= 0 ? '+' : ''}${realisedPnl.toFixed(2)} ${w!.currency}`,             color: realisedPnl >= 0 ? 'text-green' : 'text-red' },
                ].map(s => (
                  <div key={s.label} className="bg-s1 rounded-lg p-3">
                    <div className="text-[10px] text-muted uppercase tracking-wider mb-1">{s.label}</div>
                    <div className={`font-mono text-sm font-bold ${(s as any).color ?? 'text-tx'}`}>{s.value}</div>
                    {s.sub && <div className="text-[10px] text-muted mt-0.5">{s.sub}</div>}
                  </div>
                ))}
              </div>

              {marginPct > 0 && (
                <div className="bg-s1 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] text-muted uppercase tracking-wider">Margin Utilisation</div>
                    <div className={`text-[11px] font-bold ${marginPct > 80 ? 'text-red' : marginPct > 60 ? 'text-yellow-400' : 'text-tx'}`}>{marginPct}%</div>
                  </div>
                  <div className="h-1.5 bg-s2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${marginPct > 80 ? 'bg-red' : marginPct > 60 ? 'bg-yellow-400' : 'bg-accent'}`}
                      style={{ width: `${Math.min(marginPct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted">Used: {cur}{marginUsed.toFixed(2)} {w!.currency}</span>
                    <span className="text-[10px] text-muted">Free: {cur}{available.toFixed(2)} {w!.currency}</span>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                    Open Positions ({detail.positions.length})
                  </div>
                  <button
                    onClick={() => setShowPlace(true)}
                    className="text-[10px] px-2.5 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors font-semibold"
                  >
                    + Place Order
                  </button>
                </div>
                {detail.positions.length === 0 ? (
                  <p className="text-muted text-[12px]">No open positions</p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-muted text-left border-b border-border">
                        <th className="pb-1.5 font-semibold pr-4">Symbol</th>
                        <th className="pb-1.5 font-semibold pr-4">Side</th>
                        <th className="pb-1.5 font-semibold pr-4">Size</th>
                        <th className="pb-1.5 font-semibold pr-4">Avg Price</th>
                        <th className="pb-1.5 font-semibold pr-4">Mark</th>
                        <th className="pb-1.5 font-semibold pr-4">uPnL</th>
                        <th className="pb-1.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.positions.map((p, i) => {
                        const pnl = parseFloat(p.unrealisedPnl)
                        return (
                          <tr key={i} className="border-b border-border/30 last:border-0">
                            <td className="py-2 pr-4 font-mono text-[11px]">{p.symbol}</td>
                            <td className={`py-2 pr-4 font-semibold ${p.side === 'Sell' ? 'text-red' : 'text-green'}`}>{p.side}</td>
                            <td className="py-2 pr-4">{p.size}</td>
                            <td className="py-2 pr-4 font-mono">{parseFloat(p.avgPrice).toFixed(2)}</td>
                            <td className="py-2 pr-4 font-mono">{parseFloat(p.markPrice).toFixed(2)}</td>
                            <td className={`py-2 pr-4 font-mono font-semibold ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                              {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
                            </td>
                            <td className="py-2">
                              <button
                                onClick={() => closePos(p.symbol, p.side, p.size, p.account)}
                                disabled={!!closing}
                                className="text-[11px] px-2 py-0.5 rounded border border-red/40 text-red hover:bg-red/10 transition-colors disabled:opacity-40"
                              >
                                {closing === p.symbol ? '…' : `Close → ${p.side === 'Sell' ? 'Buy' : 'Sell'}`}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Open Orders</div>
                {orders.length === 0 ? (
                  <p className="text-muted text-[12px]">No pending orders.</p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-muted text-left border-b border-border">
                        <th className="pb-1.5 font-semibold pr-4">Symbol</th>
                        <th className="pb-1.5 font-semibold pr-4">Side</th>
                        <th className="pb-1.5 font-semibold pr-4">Qty</th>
                        <th className="pb-1.5 font-semibold pr-4">Price</th>
                        <th className="pb-1.5 font-semibold pr-4">Status</th>
                        <th className="pb-1.5 font-semibold pr-4">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i} className="border-b border-border/30 last:border-0">
                          <td className="py-2 pr-4 font-mono text-[11px]">{o.symbol}</td>
                          <td className={`py-2 pr-4 font-semibold ${o.side === 'Sell' ? 'text-red' : 'text-green'}`}>{o.side}</td>
                          <td className="py-2 pr-4">{o.qty}</td>
                          <td className="py-2 pr-4 font-mono">{o.price || 'Market'}</td>
                          <td className="py-2 pr-4 text-muted">{o.orderStatus}</td>
                          <td className="py-2 pr-4 text-muted">{o.orderType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
          {showPlace && detail && (
            <AccPlaceOrder
              accountName={detail.positions[0]?.account ?? 'master'}
              onClose={() => setShowPlace(false)}
              onPlaced={load}
            />
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'active' | 'paused' | 'waiting'

export default function Accounts() {
  const [accounts, setAccounts]         = useState<Account[]>([])
  const [loading, setLoading]           = useState(true)
  const [showModal, setShowModal]       = useState(false)
  const [editTarget, setEditTarget]     = useState<(Account & { idx: number }) | null>(null)
  const [expandedIdx, setExpandedIdx]   = useState<number | null>(null)
  const [liveBalances, setLiveBalances] = useState<Record<number, { equity: number; currency: string } | null>>({})
  const [transferTarget, setTransferTarget] = useState<{ idx: number | null; name: string } | null>(null)
  const [filter, setFilter]             = useState<FilterType>('all')
  const [settingMaster, setSettingMaster] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      const accs = await api.accounts.list()
      setAccounts(accs)
      accs.forEach((_, idx) => {
        api.accounts.detail(idx)
          .then(d => setLiveBalances(b => ({ ...b, [idx]: { equity: d.wallet.equity, currency: d.wallet.currency } })))
          .catch(() => setLiveBalances(b => ({ ...b, [idx]: null })))
      })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function toggleActive(idx: number) {
    await api.accounts.toggle(idx)
    load()
  }

  async function del(idx: number, name: string) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return
    await api.accounts.delete(idx)
    load()
  }

  async function setMaster(idx: number) {
    setSettingMaster(idx)
    try {
      await api.accounts.setMaster(idx)
      load()
    } catch (e: any) {
      alert(e.message ?? 'Set Master failed')
    } finally { setSettingMaster(null) }
  }

  function openAdd() { setEditTarget(null); setShowModal(true) }
  function openEdit(a: Account, idx: number) { setEditTarget({ ...a, idx }); setShowModal(true) }

  const waitingCount     = accounts.filter(a => !!a.skip_expiry).length
  const hasMultipleStatuses = accounts.some(a => !a.active) || waitingCount > 0

  const filteredWithIdx = accounts
    .map((a, i) => ({ ...a, origIdx: i }))
    .filter(a => {
      if (filter === 'active')  return a.active && !a.skip_expiry
      if (filter === 'paused')  return !a.active
      if (filter === 'waiting') return !!a.skip_expiry
      return true
    })

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-[17px] font-bold">Accounts</h1>
          <p className="text-muted text-[12px] mt-0.5">All accounts receive the same signal — lots scaled by multiplier</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTransferTarget({ idx: null, name: 'Master' })}
            className="btn-ghost flex items-center gap-1.5 text-[12px]"
          >
            ↔ Master Transfer
          </button>
          <button onClick={openAdd} className="btn-accent flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Account
          </button>
        </div>
      </div>

      {waitingCount > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/[0.08] px-4 py-3">
          <span className="text-orange-400 text-base leading-none mt-0.5">⏳</span>
          <p className="text-[13px] text-orange-300 leading-snug">
            <span className="font-semibold">{waitingCount} account{waitingCount > 1 ? 's' : ''}</span> paused until next expiry — signals resume once their API key is renewed.
          </p>
        </div>
      )}

      {hasMultipleStatuses && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {(['all', 'active', 'paused', 'waiting'] as FilterType[]).map(f => {
            const count = f === 'all'     ? accounts.length
              : f === 'active'            ? accounts.filter(a => a.active && !a.skip_expiry).length
              : f === 'paused'            ? accounts.filter(a => !a.active).length
              : accounts.filter(a => !!a.skip_expiry).length
            if (f !== 'all' && count === 0) return null
            const label = f === 'waiting' ? 'Next Expiry' : f.charAt(0).toUpperCase() + f.slice(1)
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  filter === f
                    ? 'bg-accent text-bg border-accent'
                    : 'bg-s2 text-muted border-border hover:text-tx'
                }`}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="bg-s1 border border-border rounded-card overflow-hidden">
        {loading ? (
          <div className="text-center text-muted py-10 text-sm">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center text-muted py-10 text-sm">No accounts yet. Add one above.</div>
        ) : filteredWithIdx.length === 0 ? (
          <div className="text-center text-muted py-8 text-sm">No accounts match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Name', 'Live Balance', 'Multiplier', 'API Key', 'API Expires', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredWithIdx.map(({ origIdx: i, ...a }) => {
                  const isWaiting = !!a.skip_expiry
                  const lb   = liveBalances[i]
                  const base = lb?.currency === 'USDT' ? BASE_USDT : BASE_INR
                  const mult = (a as any).lot_multiplier != null
                    ? (a as any).lot_multiplier as number
                    : lb
                    ? roundMult(lb.equity / base)
                    : roundMult(a.account_size / BASE_INR)

                  return (
                    <Fragment key={i}>
                      <tr className={`border-b border-border last:border-0 transition-colors ${isWaiting ? 'border-l-2 border-l-orange-500' : ''} ${expandedIdx === i ? 'bg-s2/30' : 'hover:bg-s2/50'} ${isWaiting ? 'opacity-70' : ''}`}>
                        <td className="px-4 py-3 font-semibold">
                          <span className={isWaiting ? 'text-muted' : ''}>{a.name}</span>
                          {isWaiting && (
                            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 font-bold uppercase tracking-wider">next expiry</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 font-mono text-[13px] ${isWaiting ? 'text-muted' : ''}`}>
                          {lb === undefined
                            ? <span className="text-muted">…</span>
                            : lb === null
                            ? <span className="text-muted">—</span>
                            : `${lb.currency === 'INR' ? '₹' : '$'}${lb.equity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="px-4 py-3">
                          <span className="badge-data">
                            {(a as any).lot_multiplier != null
                              ? `${(a as any).lot_multiplier}× (manual)`
                              : `${mult.toFixed(1)}×`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {a.api_key_masked
                            ? <span className="font-mono text-[11px] bg-s3 text-muted px-2 py-0.5 rounded">{a.api_key_masked}</span>
                            : <span className="text-muted2 text-[12px]">— master key</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <ExpiryCell expires={a.api_key_expires} />
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => toggleActive(i)} className="flex items-center gap-1.5 cursor-pointer">
                            <div className={`relative w-9 h-5 rounded-full transition-colors ${a.active ? 'bg-green' : 'bg-s3'}`}>
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow ${a.active ? 'left-4' : 'left-0.5'}`} />
                            </div>
                            <span className={`text-[11px] font-semibold ${a.active ? 'text-green' : 'text-muted'}`}>
                              {a.active ? 'Active' : 'Paused'}
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                            className={`text-[12px] px-2 py-1 rounded-md border transition-colors mr-1.5 ${expandedIdx === i ? 'bg-s3 text-tx border-border2' : 'bg-s2 border-border2 text-muted hover:text-tx'}`}
                          >
                            {expandedIdx === i ? '▲ Hide' : '▼ Monitor'}
                          </button>
                          <button
                            onClick={() => setTransferTarget({ idx: i, name: a.name })}
                            className="text-[12px] px-2 py-1 rounded-md border border-border2 bg-s2 text-muted hover:text-tx transition-colors mr-1.5"
                          >
                            ↔ Transfer
                          </button>
                          {a.api_key_masked && (
                            <button
                              onClick={() => setMaster(i)}
                              disabled={settingMaster === i}
                              className="text-[12px] px-2 py-1 rounded-md border border-accent/30 text-accent hover:bg-accent/10 transition-colors mr-1.5 disabled:opacity-40"
                            >
                              {settingMaster === i ? '…' : '★ Master'}
                            </button>
                          )}
                          <button onClick={() => openEdit(a, i)} className="btn-ghost text-[12px] mr-1.5">Edit</button>
                          <button onClick={() => del(i, a.name)} className="text-[12px] px-2 py-1 rounded-md bg-red/10 text-red hover:bg-red/20 transition-colors">✕</button>
                        </td>
                      </tr>
                      {expandedIdx === i && <AccDetailPanel key={`detail-${i}`} idx={i} onClose={() => setExpandedIdx(null)} />}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-muted2 text-[11px] mt-3 leading-relaxed">
        Base ₹50,000 (INR) / $530 (USDT) = 1×. Multiplier auto-computed from live balance; floored to nearest 0.5×, minimum 1×. Example: $530 equity → 1.0×, $795 → 1.5×, $1060 → 2.0×.
      </p>

      {showModal && (
        <AccountModal
          account={editTarget}
          onClose={() => setShowModal(false)}
          onSave={load}
        />
      )}

      {transferTarget && (
        <FundTransferModal
          accountIdx={transferTarget.idx}
          accountName={transferTarget.name}
          onClose={() => setTransferTarget(null)}
        />
      )}
    </div>
  )
}
