import { useEffect, useState } from 'react'
import { api, JournalData, ExecutionsData } from '../api'

function fmt(n: number) {
  const s = Math.abs(n).toFixed(4)
  return (n < 0 ? '−' : '+') + s
}

function relTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type Tab = 'orders' | 'executions'

export default function Journal() {
  const [journal, setJournal] = useState<JournalData | null>(null)
  const [execs, setExecs] = useState<ExecutionsData | null>(null)
  const [tab, setTab] = useState<Tab>('orders')
  const [execErr, setExecErr] = useState('')

  useEffect(() => {
    api.journal.trades().then(setJournal).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'executions') return
    api.journal.executions()
      .then(setExecs)
      .catch(e => setExecErr(e.message ?? 'API error'))
  }, [tab])

  const stats = journal ? [
    { label: 'Total Orders',  value: journal.total_trades, color: 'text-tx' },
    { label: 'Sell (Short)',  value: journal.sells,         color: 'text-red' },
    { label: 'Buy / Exit',   value: journal.buys + journal.exits, color: 'text-green' },
  ] : []

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="mb-2">
        <h1 className="text-[17px] font-bold">Journal</h1>
        <p className="text-muted text-[12px] mt-0.5">Auto-maintained trade log &amp; execution history</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-s1 border border-border rounded-card p-4">
            <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">{s.label}</div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
          </div>
        ))}
        {/* Realized PnL from executions */}
        <div className="bg-s1 border border-border rounded-card p-4 col-span-3 sm:col-span-1">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Realised PnL (API)</div>
          <div className={`font-mono text-2xl font-bold tabular-nums ${
            execs == null ? 'text-tx' : execs.total_realised_pnl >= 0 ? 'text-green' : 'text-red'
          }`}>
            {execs == null ? '—' : `${fmt(execs.total_realised_pnl)} USDT`}
          </div>
          <div className="text-[11px] text-muted mt-1">Last 50 fills</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-bg border border-border rounded-lg p-0.5 gap-0.5 w-fit">
        {([['orders', 'Order Log'], ['executions', 'Executions (API)']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-md text-[12px] font-semibold transition-colors ${tab === key ? 'bg-s2 text-tx' : 'text-muted hover:text-tx'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Order log */}
      {tab === 'orders' && (
        <div className="bg-s1 border border-border rounded-card overflow-hidden">
          {!journal ? (
            <div className="p-6 text-muted text-sm">Loading…</div>
          ) : journal.trades.length === 0 ? (
            <div className="p-6 text-muted text-sm">No orders placed yet. Orders appear here once the bot executes a signal.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-muted border-b border-border bg-s2">
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-4 py-2.5 font-semibold">Account</th>
                    <th className="px-4 py-2.5 font-semibold">Symbol</th>
                    <th className="px-4 py-2.5 font-semibold">Side</th>
                    <th className="px-4 py-2.5 font-semibold">Lots</th>
                    <th className="px-4 py-2.5 font-semibold">Price</th>
                    <th className="px-4 py-2.5 font-semibold">Multiplier</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.trades.map((t, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-s2/50 transition-colors">
                      <td className="px-4 py-2.5 text-muted font-mono">{relTime(t.timestamp)}</td>
                      <td className="px-4 py-2.5">{t.account}</td>
                      <td className="px-4 py-2.5 font-mono text-tx/90 text-[11px]">{t.symbol}</td>
                      <td className={`px-4 py-2.5 font-semibold ${t.side === 'Sell' ? 'text-red' : 'text-green'}`}>{t.side}</td>
                      <td className="px-4 py-2.5 tabular-nums">{t.lots} <span className="text-muted">({t.mentor_lots} mentor)</span></td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">{parseFloat(t.price || '0').toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-accent tabular-nums">{t.multiplier}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Executions */}
      {tab === 'executions' && (
        <div className="bg-s1 border border-border rounded-card overflow-hidden">
          {execErr ? (
            <div className="p-6 text-red text-sm">{execErr}</div>
          ) : !execs ? (
            <div className="p-6 text-muted text-sm">Loading from API…</div>
          ) : execs.executions.length === 0 ? (
            <div className="p-6 text-muted text-sm">No filled orders yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-muted border-b border-border bg-s2">
                    <th className="px-4 py-2.5 font-semibold">Time</th>
                    <th className="px-4 py-2.5 font-semibold">Symbol</th>
                    <th className="px-4 py-2.5 font-semibold">Side</th>
                    <th className="px-4 py-2.5 font-semibold">Qty</th>
                    <th className="px-4 py-2.5 font-semibold">Fill Price</th>
                    <th className="px-4 py-2.5 font-semibold">Closed PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {execs.executions.map((e, i) => {
                    const pnl = parseFloat(e.closedPnl || '0')
                    return (
                      <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-s2/50 transition-colors">
                        <td className="px-4 py-2.5 text-muted font-mono">{relTime(new Date(parseInt(e.execTime)).toISOString())}</td>
                        <td className="px-4 py-2.5 font-mono text-tx/90 text-[11px]">{e.symbol}</td>
                        <td className={`px-4 py-2.5 font-semibold ${e.side === 'Sell' ? 'text-red' : 'text-green'}`}>{e.side}</td>
                        <td className="px-4 py-2.5 tabular-nums">{e.execQty}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{parseFloat(e.execPrice).toFixed(4)}</td>
                        <td className={`px-4 py-2.5 font-mono font-semibold tabular-nums ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                          {pnl !== 0 ? fmt(pnl) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
