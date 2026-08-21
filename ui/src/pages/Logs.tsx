import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

type Filter = 'all' | 'signal' | 'order' | 'error' | 'heartbeat' | 'system'

function classify(line: string): Filter {
  if (line.includes('Signal') || line.includes('signal') || line.includes('Gemini')) return 'signal'
  if (line.includes('[DRY RUN]') || line.includes('Order placed') || line.includes('Would place')) return 'order'
  if (line.includes('ERROR') || line.includes('error') || line.includes('failed') || line.includes('Failed')) return 'error'
  if (line.includes('Heartbeat') || line.includes('heartbeat')) return 'heartbeat'
  return 'system'
}

function lineColor(line: string): string {
  const f = classify(line)
  if (f === 'signal')    return 'text-blue'
  if (f === 'order')     return 'text-yellow-400'
  if (f === 'error')     return 'text-red'
  if (f === 'heartbeat') return 'text-muted'
  if (line.includes('Running') || line.includes('connected') || line.includes('live') || line.includes('placed')) return 'text-green'
  return 'text-tx/70'
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'signal',    label: '📊 Signals' },
  { key: 'order',     label: '🔵 Orders' },
  { key: 'error',     label: '❌ Errors' },
  { key: 'heartbeat', label: '💓 Heartbeat' },
  { key: 'system',    label: '✅ System' },
]

export default function Logs() {
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  // Initial load
  useEffect(() => {
    api.logs(500).then(r => setLines(r.lines)).catch(() => {})
  }, [])

  // SSE stream for live updates
  useEffect(() => {
    const es = new EventSource(api.logsStreamUrl, { withCredentials: true })
    es.onmessage = (e) => {
      try {
        const { line } = JSON.parse(e.data)
        setLines(prev => [...prev.slice(-800), line])
      } catch { /* ignore */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const visible = filter === 'all' ? lines : lines.filter(l => classify(l) === filter)

  return (
    <div className="flex flex-col h-full p-4 sm:p-6 gap-3" style={{ height: 'calc(100vh - 3rem)' }}>
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-[17px] font-bold">Logs</h1>
          <p className="text-muted text-[12px] mt-0.5">trades.log · streaming live</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              fetch('/api/logs/clear', { method: 'POST', credentials: 'include' })
                .then(() => setLines([]))
                .catch(() => {})
            }}
            className="btn-ghost text-[12px] text-red/70 hover:text-red"
          >
            🗑 Clear
          </button>
          <button
            onClick={() => { setAutoScroll(true); logRef.current?.scrollTo(0, logRef.current.scrollHeight) }}
            className="btn-ghost text-[12px]"
          >
            ↓ Latest
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap flex-shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-[12px] font-semibold px-3 py-1 rounded-full border transition-colors ${
              filter === f.key
                ? 'bg-s3 text-tx border-border2'
                : 'text-muted border-border hover:text-tx hover:border-border2'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-muted text-[11px] self-center">{visible.length} lines</span>
      </div>

      {/* Log display */}
      <div
        ref={logRef}
        onScroll={e => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          setAutoScroll(atBottom)
        }}
        className="flex-1 log-viewport min-h-0"
      >
        {visible.length === 0 ? (
          <span className="text-muted">No entries matching this filter…</span>
        ) : (
          visible.map((line, i) => (
            <div key={i} className={lineColor(line)}>{line}</div>
          ))
        )}
      </div>

      {!autoScroll && (
        <div className="text-center flex-shrink-0">
          <button onClick={() => { setAutoScroll(true) }} className="text-[11px] text-accent underline">
            Resume auto-scroll
          </button>
        </div>
      )}
    </div>
  )
}
