import { useState, useEffect } from 'react'
import { api, Account, AccountInput, AccountDetail } from '../api'

const MENTOR_BASE = 50000

function multiplier(size: number) {
  return (size / MENTOR_BASE).toFixed(2)
}

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

  const mult = (form.account_size / MENTOR_BASE).toFixed(2)
  const exampleLots = Math.max(1, Math.round(5 * form.account_size / MENTOR_BASE))

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
          <div>
            <label className="text-[11px] text-muted font-semibold uppercase tracking-wider block mb-1">Account Size (INR)</label>
            <input className="input font-mono" type="number" value={form.account_size} onChange={e => setForm(f => ({ ...f, account_size: Number(e.target.value) }))} />
          </div>

          {/* Lot multiplier — computed or custom */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted font-semibold uppercase tracking-wider">Lot Multiplier</label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={useCustomMult}
                  onChange={e => {
                    setUseCustomMult(e.target.checked)
                    setForm(f => ({ ...f, lot_multiplier: e.target.checked ? parseFloat(mult) : null }))
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
              <div className="badge-data py-2 block text-center">
                {mult}× computed from account size · mentor 5 lots → you get {exampleLots}
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

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<(Account & { idx: number }) | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try { setAccounts(await api.accounts.list()) } finally { setLoading(false) }
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

  function openAdd() { setEditTarget(null); setShowModal(true) }
  function openEdit(a: Account, idx: number) { setEditTarget({ ...a, idx }); setShowModal(true) }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-[17px] font-bold">Accounts</h1>
          <p className="text-muted text-[12px] mt-0.5">All accounts receive the same signal — lots scaled by multiplier</p>
        </div>
        <button onClick={openAdd} className="btn-accent flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Account
        </button>
      </div>

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
                  {['Name', 'Size', 'Multiplier', 'API Key', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => (
                  <>
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-s2/50 transition-colors">
                      <td className="px-4 py-3 font-semibold">{a.name}</td>
                      <td className="px-4 py-3 font-mono text-[13px]">₹{a.account_size.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <span className="badge-data">
                          {(a as any).lot_multiplier != null
                            ? `${(a as any).lot_multiplier}× (manual)`
                            : `${multiplier(a.account_size)}×`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {a.api_key_masked
                          ? <span className="font-mono text-[11px] bg-s3 text-muted px-2 py-0.5 rounded">{a.api_key_masked}</span>
                          : <span className="text-muted2 text-[12px]">— master key</span>
                        }
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
                          className={`text-[12px] px-2 py-1 rounded-md border transition-colors mr-2 ${expandedIdx === i ? 'bg-s3 text-tx border-border2' : 'bg-s2 border-border2 text-muted hover:text-tx'}`}
                        >
                          {expandedIdx === i ? '▲ Hide' : '▼ Monitor'}
                        </button>
                        <button onClick={() => openEdit(a, i)} className="btn-ghost text-[12px] mr-2">Edit</button>
                        <button onClick={() => del(i, a.name)} className="text-[12px] px-2 py-1 rounded-md bg-red/10 text-red hover:bg-red/20 transition-colors">✕</button>
                      </td>
                    </tr>
                    {expandedIdx === i && <AccDetailPanel key={`detail-${i}`} idx={i} onClose={() => setExpandedIdx(null)} />}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-muted2 text-[11px] mt-3 leading-relaxed">
        Mentor baseline ₹50,000 = 1×. Multiplier = your size ÷ 50,000. Lots rounded to nearest whole number.
      </p>

      {showModal && (
        <AccountModal
          account={editTarget}
          onClose={() => setShowModal(false)}
          onSave={load}
        />
      )}
    </div>
  )
}
