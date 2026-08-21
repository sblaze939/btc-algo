import { useState, useEffect } from 'react'
import { api, Account, AccountInput, AccountDetail } from '../api'

const BASE_SIZE = 50000

function roundMult(size: number): string {
  const raw   = size / BASE_SIZE
  const whole = Math.floor(raw)
  const frac  = raw - whole
  const mult  = Math.max(1, frac < 0.5 ? whole : whole + 0.5)
  return mult.toFixed(1) + '×'
}

type FilterStatus = 'active' | 'paused' | 'waiting'

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

  const mult = (form.account_size / BASE_SIZE).toFixed(2)
  const exampleLots = Math.max(1, Math.round(5 * form.account_size / BASE_SIZE))

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
          {/* Lot multiplier — manual override only; auto-computed from live balance at runtime */}
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
                step="0.01"
                min="0.01"
                value={form.lot_multiplier ?? ''}
                onChange={e => setForm(f => ({ ...f, lot_multiplier: parseFloat(e.target.value) || null }))}
                placeholder="e.g. 2.5"
              />
            ) : (
              <div className="badge-data py-2 block text-center text-[11px]">
                Auto — computed from live wallet balance ÷ ₹50,000
              </div>
            )}
          </div>

          {account?.is_master ? (
            <div className="rounded-lg border border-border bg-bg px-4 py-3 text-[12px] text-muted leading-relaxed">
              API credentials for the master account are managed in{' '}
              <span className="text-tx font-semibold">Settings → Master API Configuration</span>.
            </div>
          ) : (
            <>
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
            </>
          )}

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

function AccDetailPanel({ idx, onClose }: { idx: number; onClose: () => void }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [err, setErr] = useState('')
  const [closing, setClosing] = useState<string | null>(null)

  useEffect(() => {
    api.accounts.detail(idx)
      .then(setDetail)
      .catch(e => setErr(e.message ?? 'API error'))
  }, [idx])

  async function closePos(symbol: string, side: string, size: string, account: string) {
    setClosing(symbol)
    try {
      await api.portfolio.close({ symbol, side, size, account })
      const d = await api.accounts.detail(idx)
      setDetail(d)
    } catch (e: any) {
      alert(e.message ?? 'Close failed')
    } finally {
      setClosing(null)
    }
  }

  return (
    <tr>
      <td colSpan={6} className="px-4 pb-4 pt-0">
        <div className="bg-bg border border-border2 rounded-xl p-4 space-y-3">
          {err && <p className="text-red text-[12px]">{err}</p>}
          {!detail && !err && <p className="text-muted text-[12px]">Fetching from API…</p>}
          {detail && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Equity', value: `${detail.wallet.currency === 'INR' ? '₹' : '$'}${detail.wallet.equity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                  { label: 'Wallet Balance', value: `${detail.wallet.currency === 'INR' ? '₹' : '$'}${detail.wallet.wallet_balance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
                  { label: 'Unrealised PnL', value: `${detail.wallet.unrealised_pnl >= 0 ? '+' : ''}${detail.wallet.unrealised_pnl.toFixed(2)} ${detail.wallet.currency ?? 'INR'}`, color: detail.wallet.unrealised_pnl >= 0 ? 'text-green' : 'text-red' },
                ].map(s => (
                  <div key={s.label} className="bg-s1 rounded-lg p-3">
                    <div className="text-[10px] text-muted uppercase tracking-wider mb-1">{s.label}</div>
                    <div className={`font-mono text-sm font-bold ${s.color ?? 'text-tx'}`}>{s.value}</div>
                  </div>
                ))}
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
                              {closing === p.symbol ? '…' : `Close`}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

function FundModal({ idx, name, onClose }: { idx: number; name: string; onClose: () => void }) {
  const [amt, setAmt] = useState('')
  const [transferring, setTransferring] = useState<'IN' | 'OUT' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function doTransfer(direction: 'IN' | 'OUT') {
    const amount = parseFloat(amt)
    if (!amount || amount <= 0) return
    setTransferring(direction)
    setMsg(null)
    try {
      const res = await api.funds.transferForAccount(idx, direction, amount)
      setMsg({ ok: true, text: direction === 'IN'
        ? `₹${amount.toLocaleString()} → trading wallet (~${(amount / 94).toFixed(1)} USDT)`
        : `₹${amount.toLocaleString()} ← returned to Spot Wallet` })
      setAmt('')
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Transfer failed' })
    } finally {
      setTransferring(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-s1 border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-1">Fund Trading Wallet</h2>
        <p className="text-[12px] text-muted mb-4 leading-relaxed">
          <span className="font-semibold text-tx">{name}</span> — transfers between CoinSwitch <span className="text-tx font-semibold">Spot Wallet (INR)</span> and the <span className="text-tx font-semibold">HFT/DMA trading wallet</span>. INR is converted at ~₹94/USDT.
          <br />
          <span className="text-amber-400 text-[11px]">Make sure INR is in the Spot Wallet first — not Options Wallet.</span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted font-semibold uppercase tracking-wider block mb-1">Amount (₹)</label>
            <input
              className="input font-mono"
              type="number"
              min="1"
              placeholder="e.g. 50000"
              value={amt}
              onChange={e => setAmt(e.target.value)}
            />
            {amt && parseFloat(amt) > 0 && (
              <p className="text-[11px] text-muted mt-1">≈ {(parseFloat(amt) / 94).toFixed(2)} USDT at ₹94/USDT</p>
            )}
          </div>

          {msg && (
            <p className={`text-[12px] ${msg.ok ? 'text-green' : 'text-red'}`}>
              {msg.ok ? '✓' : '✗'} {msg.text}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => doTransfer('IN')}
              disabled={!!transferring || !amt}
              className="flex-1 py-2 rounded-lg border border-green/50 text-green text-[12px] font-semibold hover:bg-green/10 transition-colors disabled:opacity-40"
            >
              {transferring === 'IN' ? 'Moving…' : 'Spot → Trading'}
            </button>
            <button
              onClick={() => doTransfer('OUT')}
              disabled={!!transferring || !amt}
              className="flex-1 py-2 rounded-lg border border-border text-muted text-[12px] font-semibold hover:text-tx hover:border-tx/40 transition-colors disabled:opacity-40"
            >
              {transferring === 'OUT' ? 'Moving…' : 'Trading → Spot'}
            </button>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="btn-ghost text-[13px]">Close</button>
        </div>
      </div>
    </div>
  )
}

interface MasterConfirmState {
  pendingIdx: number
  pendingName: string
  currentMaster: string
}

export default function Accounts() {
  const [accounts,     setAccounts]     = useState<Account[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showModal,    setShowModal]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<(Account & { idx: number }) | null>(null)
  const [expandedIdx,  setExpandedIdx]  = useState<number | null>(null)
  const [liveBalances, setLiveBalances] = useState<Record<number, { equity: number; currency: string } | null>>({})
  const [masterConfirm,  setMasterConfirm]  = useState<MasterConfirmState | null>(null)
  const [settingMaster,  setSettingMaster]  = useState<number | null>(null)
  const [deleteConfirm,  setDeleteConfirm]  = useState<{ idx: number; name: string } | null>(null)
  const [fundTarget,     setFundTarget]     = useState<{ idx: number; name: string } | null>(null)
  const [filter,         setFilter]         = useState<FilterStatus | null>(null)
  const [nextExpiry,     setNextExpiry]     = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [accs, settings] = await Promise.all([
        api.accounts.list(),
        api.settings.get(),
      ])
      setAccounts(accs)
      setNextExpiry(settings.next_expiry ?? null)
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
    setDeleteConfirm({ idx, name })
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    const { idx } = deleteConfirm
    setDeleteConfirm(null)
    await api.accounts.delete(idx)
    load()
  }

  function openAdd() { setEditTarget(null); setShowModal(true) }
  function openEdit(a: Account, idx: number) { setEditTarget({ ...a, idx }); setShowModal(true) }

  function requestSetMaster(idx: number, name: string) {
    const current = accounts.find(a => a.is_master)
    if (!current || current.name === name) {
      confirmSetMaster(idx)
      return
    }
    setMasterConfirm({ pendingIdx: idx, pendingName: name, currentMaster: current.name })
  }

  async function confirmSetMaster(idx: number) {
    setMasterConfirm(null)
    setSettingMaster(idx)
    try {
      await api.accounts.setMaster(idx)
      await load()
    } finally {
      setSettingMaster(null)
    }
  }

  // Derive status groups for chips
  const waitingAccounts = accounts.filter(a => a.is_waiting)
  const hasActive  = accounts.some(a => a.active && !a.is_waiting)
  const hasPaused  = accounts.some(a => !a.active)
  const hasWaiting = waitingAccounts.length > 0
  const multipleStatuses = [hasActive, hasPaused, hasWaiting].filter(Boolean).length > 1

  const statusOf = (a: Account): FilterStatus =>
    a.is_waiting ? 'waiting' : a.active ? 'active' : 'paused'

  const visibleAccounts = filter
    ? accounts.filter(a => statusOf(a) === filter)
    : accounts

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[17px] font-bold">Accounts</h1>
          <p className="text-muted text-[12px] mt-0.5">All accounts receive the same signal — lots scaled by multiplier</p>
        </div>
        <button onClick={openAdd} className="btn-accent flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Account
        </button>
      </div>

      {/* Info banner — only when accounts are waiting for next expiry */}
      {hasWaiting && (
        <div className="flex items-center gap-3 border border-orange-400/20 bg-orange-400/5 rounded-card px-4 py-3 text-[12px] text-orange-200 leading-relaxed">
          <span className="text-orange-400 text-[14px] flex-shrink-0">ℹ</span>
          <span>
            <span className="font-semibold text-orange-400">{waitingAccounts.length} account{waitingAccounts.length > 1 ? 's' : ''}</span>
            {' '}were added mid-session and will skip signals for the current expiry.
            {nextExpiry && (
              <> They will begin trading automatically from the next expiry <span className="font-semibold text-orange-400">{nextExpiry}</span>.</>
            )}
            {' '}No action required.
          </span>
        </div>
      )}

      {/* Filter chips — only when multiple status types exist */}
      {multipleStatuses && (
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: null,      label: 'All',          count: accounts.length,              cls: 'border-border2 text-tx bg-s3' },
            hasActive  && { key: 'active'  as const, label: 'Active',      count: accounts.filter(a => statusOf(a) === 'active').length,  cls: 'border-green/30 text-green  bg-green/5' },
            hasPaused  && { key: 'paused'  as const, label: 'Paused',      count: accounts.filter(a => statusOf(a) === 'paused').length,  cls: 'border-border2 text-muted   bg-s2'      },
            hasWaiting && { key: 'waiting' as const, label: 'Next Expiry', count: waitingAccounts.length,                                 cls: 'border-orange-400/30 text-orange-400 bg-orange-400/5' },
          ].filter(Boolean).map((chip: any) => {
            const isSelected = filter === chip.key
            return (
              <button
                key={String(chip.key)}
                onClick={() => setFilter(isSelected ? null : chip.key)}
                className={[
                  'px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors',
                  isSelected ? chip.cls : 'border-border2 text-muted hover:text-tx',
                ].join(' ')}
              >
                {chip.label}
                <span className="ml-1.5 text-[10px] opacity-60">{chip.count}</span>
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Name', 'Live Balance', 'Multiplier', 'API Key', 'Expires In', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((a, i) => {
                  const realIdx = accounts.indexOf(a)
                  const isWaiting = a.is_waiting
                  const isPaused  = !a.active
                  return (
                  <>
                    <tr key={realIdx} className={[
                      'border-b border-border last:border-0 hover:bg-s2/50 transition-colors',
                      isWaiting ? 'border-l-2 border-l-orange-400/50' : '',
                    ].join(' ')}>
                      <td className="px-4 py-3 font-semibold">
                        <span className={`flex items-center gap-2 flex-wrap ${isPaused && !isWaiting ? 'text-muted' : ''}`}>
                          {a.name}
                          {a.is_master && (
                            <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
                              Master
                            </span>
                          )}
                          {isWaiting && (
                            <span
                              title={`Skipping ${a.skip_expiry} — joined mid-session. Trades start from ${nextExpiry ?? 'next expiry'} automatically.`}
                              className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-orange-400/12 text-orange-400 border border-orange-400/30 cursor-default"
                            >
                              next expiry
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-mono text-[13px] ${isWaiting || isPaused ? 'text-muted' : ''}`}>
                        {liveBalances[realIdx] === undefined
                          ? <span className="text-muted">…</span>
                          : liveBalances[realIdx] === null
                          ? <span className="text-muted">—</span>
                          : `${liveBalances[realIdx]!.currency === 'INR' ? '₹' : '$'}${liveBalances[realIdx]!.equity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge-data">
                          {(a as any).lot_multiplier != null
                            ? `${(a as any).lot_multiplier}× (manual)`
                            : roundMult(a.account_size)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {a.api_key_masked
                          ? <span className="font-mono text-[11px] bg-s3 text-muted px-2 py-0.5 rounded">{a.api_key_masked}</span>
                          : <span className="text-muted2 text-[12px]">— master key</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px]">
                        {a.days_until_expiry == null
                          ? <span className="text-muted">—</span>
                          : a.days_until_expiry <= 0
                          ? <span className="text-red font-semibold">Expired</span>
                          : <span className={a.days_until_expiry <= 10 ? 'text-red font-semibold' : a.days_until_expiry <= 30 ? 'text-amber-400' : 'text-green'}>
                              {a.days_until_expiry}d
                            </span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive(realIdx)} className="flex items-center gap-1.5 cursor-pointer">
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
                          onClick={() => setExpandedIdx(expandedIdx === realIdx ? null : realIdx)}
                          className={`text-[12px] px-2 py-1 rounded-md border transition-colors mr-2 ${expandedIdx === realIdx ? 'bg-s3 text-tx border-border2' : 'bg-s2 border-border2 text-muted hover:text-tx'}`}
                        >
                          {expandedIdx === realIdx ? '▲ Hide' : '▼ Monitor'}
                        </button>
                        {!a.is_master && (
                          <button
                            onClick={() => requestSetMaster(realIdx, a.name)}
                            disabled={settingMaster === realIdx}
                            className="text-[12px] px-2 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-colors mr-2 disabled:opacity-40"
                          >
                            {settingMaster === realIdx ? '…' : 'Set Master'}
                          </button>
                        )}
                        <button
                          onClick={() => setFundTarget({ idx: realIdx, name: a.name })}
                          className="text-[12px] px-2 py-1 rounded-md border border-green/40 text-green hover:bg-green/10 transition-colors mr-2"
                        >
                          Fund
                        </button>
                        <button onClick={() => openEdit(a, realIdx)} className="btn-ghost text-[12px] mr-2">Edit</button>
                        <button onClick={() => del(realIdx, a.name)} className="text-[12px] px-2 py-1 rounded-md bg-red/10 text-red hover:bg-red/20 transition-colors">✕</button>
                      </td>
                    </tr>
                    {expandedIdx === realIdx && <AccDetailPanel key={`detail-${realIdx}`} idx={realIdx} onClose={() => setExpandedIdx(null)} />}
                  </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-muted2 text-[11px] leading-relaxed">
        Base size ₹50,000 = 1×. Multiplier rounds to nearest 0.5× step. Override per account if needed.
      </p>

      {showModal && (
        <AccountModal
          account={editTarget}
          onClose={() => setShowModal(false)}
          onSave={load}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-s1 border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-red/15 border border-red/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold">Remove Account?</h2>
                <p className="text-muted text-[12px] mt-1.5 leading-relaxed">
                  <span className="text-tx font-semibold">{deleteConfirm.name}</span> will be permanently removed from the bot.
                  This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="btn-ghost text-[13px]">Cancel</button>
              <button
                onClick={confirmDelete}
                className="text-[13px] px-4 py-1.5 rounded-lg bg-red text-white font-semibold hover:opacity-90 transition-opacity"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {fundTarget && (
        <FundModal
          idx={fundTarget.idx}
          name={fundTarget.name}
          onClose={() => setFundTarget(null)}
        />
      )}

      {masterConfirm && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setMasterConfirm(null)}>
          <div className="bg-s1 border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"/></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold">Change Master Account?</h2>
                <p className="text-muted text-[12px] mt-1.5 leading-relaxed">
                  <span className="text-tx font-semibold">{masterConfirm.currentMaster}</span> is currently the master account.
                  Setting <span className="text-tx font-semibold">{masterConfirm.pendingName}</span> as master will demote{' '}
                  <span className="text-tx font-semibold">{masterConfirm.currentMaster}</span> to a child account — it will
                  continue receiving signals and trading normally, just without master status.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMasterConfirm(null)} className="btn-ghost text-[13px]">Cancel</button>
              <button
                onClick={() => confirmSetMaster(masterConfirm.pendingIdx)}
                className="text-[13px] px-4 py-1.5 rounded-lg bg-accent text-bg font-semibold hover:opacity-90 transition-opacity"
              >
                Yes, Change Master
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
