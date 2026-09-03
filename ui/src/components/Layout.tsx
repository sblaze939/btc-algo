import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { api, BotStatus } from '../api'

// ── Icons ─────────────────────────────────────────────────────────────────────
const IcoDash    = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
const IcoAccs    = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>
const IcoLogs    = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
const IcoSettings= () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
const IcoJournal = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
const IcoPlay    = () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polygon points="5 3 19 12 5 21 5 3"/></svg>
const IcoStop    = () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
const IcoRestart = () => <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.86"/></svg>

const IcoTrading     = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
const IcoPerformance = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="7 13 10 10 13 12 17 7"/></svg>

const NAV = [
  { to: '/dashboard',   label: 'Dashboard',   Icon: IcoDash },
  { to: '/accounts',    label: 'Accounts',    Icon: IcoAccs },
  { to: '/trading',     label: 'Trading',     Icon: IcoTrading },
  { to: '/performance', label: 'Performance', Icon: IcoPerformance },
  { to: '/journal',     label: 'Journal',     Icon: IcoJournal },
  { to: '/settings',    label: 'Settings',    Icon: IcoSettings },
  { to: '/logs',        label: 'Logs',        Icon: IcoLogs },
]

function navCls({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center justify-center w-11 h-11 rounded-[10px] transition-colors relative',
    isActive
      ? 'bg-s2 text-tx shadow-card'
      : 'text-muted hover:bg-s2/60 hover:text-tx',
  ].join(' ')
}

function mobileNavCls({ isActive }: { isActive: boolean }) {
  return [
    'flex flex-col items-center gap-1 flex-1 py-2 text-[10px] font-semibold transition-colors',
    isActive ? 'text-accent' : 'text-muted',
  ].join(' ')
}

function LogoMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const [hasLogo, setHasLogo] = useState<boolean | null>(null)
  const dim = size === 'sm' ? 'w-8 h-8 text-xs rounded-lg' : 'w-10 h-10 text-sm rounded-[10px]'
  return (
    <div className={`${dim} bg-gradient-to-br from-accent to-[#A07820] flex items-center justify-center font-bold text-bg mb-3 shadow-[0_4px_14px_rgba(212,168,67,0.25)] overflow-hidden flex-shrink-0`}>
      {hasLogo === false
        ? 'KA'
        : <img src={`/api/logo?t=${Math.floor(Date.now()/60000)}`} className="w-full h-full object-cover" onLoad={() => setHasLogo(true)} onError={() => setHasLogo(false)} alt="logo" />
      }
    </div>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [acting, setActing] = useState(false)

  const fetchStatus = useCallback(async () => {
    try { setStatus(await api.status()) } catch { /* 401 redirects */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 8000)
    return () => clearInterval(id)
  }, [fetchStatus])

  async function botAction(action: 'start' | 'stop' | 'restart') {
    setActing(true)
    try {
      if (action === 'start')   await api.bot.start()
      if (action === 'stop')    await api.bot.stop()
      if (action === 'restart') await api.bot.restart()
      setTimeout(fetchStatus, 2500)
    } finally {
      setActing(false)
    }
  }

  const running = status?.running ?? false

  return (
    <div className="flex h-full bg-bg text-tx">

      {/* ── Sidebar (desktop) ── */}
      <aside className="hidden sm:flex flex-col items-center w-16 bg-s1 border-r border-border py-4 gap-1 flex-shrink-0">
        {/* Logo */}
        <LogoMark />

        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={navCls} title={label}>
            <Icon />
          </NavLink>
        ))}

        <div className="mt-auto pb-1">
          <div className="text-[8px] text-muted2 text-center leading-tight select-none" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            © {new Date().getFullYear()} KiraFX
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Topbar */}
        <header className="flex items-center gap-3 px-4 h-12 bg-s1 border-b border-border flex-shrink-0">
          <span className="font-bold text-[15px] tracking-tight hidden sm:block">
            Kirasha <span className="text-accent">BTC Algo</span>
          </span>

          {/* Status dot + label */}
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
              style={{
                background: running ? '#6ECC84' : '#E06060',
                boxShadow: running ? '0 0 6px #6ECC84' : 'none',
                animation: running ? 'breathing 2s ease-in-out infinite' : 'none',
              }}
            />
            <span className="text-[13px] font-semibold">
              {status ? (running ? 'Running' : 'Stopped') : '…'}
            </span>
          </div>

          {/* System-state chip only */}
          {status && (
            <span className={[
              'chip-system',
              status.dry_run
                ? 'text-[#C8A030] border-[#C8A030]/40 bg-[#C8A030]/8'
                : 'text-green border-green/40 bg-green/8',
            ].join(' ')}>
              {status.dry_run ? 'DRY RUN' : 'LIVE'}
            </span>
          )}

          <div className="flex-1" />

          {/* Bot control — contextual */}
          <div className="flex bg-s2 border border-border2 rounded-lg overflow-hidden text-[12px] font-semibold">
            {running ? (
              <>
                <button
                  disabled={acting}
                  onClick={() => botAction('stop')}
                  className="flex items-center gap-1.5 px-3 py-2 text-red hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <IcoStop /> Stop
                </button>
                <div className="w-px bg-border" />
                <button
                  disabled={acting}
                  onClick={() => botAction('restart')}
                  className="flex items-center gap-1.5 px-3 py-2 text-accent hover:bg-white/5 transition-colors disabled:opacity-40"
                >
                  <IcoRestart /> Restart
                </button>
              </>
            ) : (
              <button
                disabled={acting}
                onClick={() => botAction('start')}
                className="flex items-center gap-1.5 px-3 py-2 text-green hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <IcoPlay /> Start
              </button>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-16 sm:pb-0">
          <Outlet context={{ status, refetchStatus: fetchStatus }} />
        </main>

      </div>

      {/* ── Bottom nav (mobile) ── */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-s1 border-t border-border flex safe-bottom z-50">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={mobileNavCls}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
