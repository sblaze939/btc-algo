// KiraFX Algos — API client
// All requests include credentials (cookie) and redirect to /login on 401.

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BotStatus {
  running: boolean
  pid: number | null
  dry_run: boolean
  live_from: string
  signal_mode: string          // image | text | both
  uptime_seconds: number | null
}

export interface Account {
  name: string
  account_size: number
  active: boolean
  api_key_masked: string       // truncated, no secret exposed
  api_key_expires?: string | null  // ISO date string, null if not set
  lot_multiplier?: number | null
  skip_expiry?: string | null      // ISO date — account paused until next cycle
}

export interface AccountInput {
  name: string
  account_size: number
  active: boolean
  api_key: string
  api_secret: string
  lot_multiplier: number | null  // null = compute from account_size / 50000
}

export interface Settings {
  dry_run: boolean
  live_from: string
  trade_from_expiry?: string
  signal_mode: string
  alert_chat_id: string
  source_channel_id?: string
  api_key_set: boolean
  api_key_expires: string
}

export interface SettingsInput {
  dry_run: boolean
  live_from: string
  trade_from_expiry?: string
  signal_mode: string
  alert_chat_id: string
  source_channel_id?: string
  bot_token: string
  cs_api_key: string      // leave blank to keep current
  cs_api_secret: string   // leave blank to keep current
}

export interface WalletBalance {
  currency: string        // INR or USDT, as returned by CoinSwitch
  equity: number
  wallet_balance: number
  unrealised_pnl: number
  margin_used: number
  margin_rate: number     // 0–1 fraction
  available: number
}

export interface Position {
  account: string
  symbol: string
  side: string
  size: string
  avgPrice: string
  markPrice: string
  unrealisedPnl: string
  leverage: string
}

export interface AccountDetail {
  wallet: WalletBalance
  positions: Position[]
}

export interface TradeRecord {
  timestamp: string
  account: string
  action: string
  side: string
  strike: number
  option_type: string
  lots: number
  mentor_lots: number
  multiplier: number
  symbol: string
  price: string
  order_id?: string
}

export interface JournalData {
  trades: TradeRecord[]
  total_trades: number
  sells: number
  buys: number
  exits: number
}

export interface Execution {
  symbol: string
  side: string
  orderType: string
  execTime: string
  execPrice: string
  execQty: string
  closedPnl: string
}

export interface ExecutionsData {
  executions: Execution[]
  total_realised_pnl: number
}

export interface ExecutionRecord {
  symbol: string
  side: string
  orderType: string
  execTime: string
  execPrice: string
  execQty: string
  closedPnl: string
}

export interface Instrument {
  symbol: string
  strike: string
  type: string    // "Call" or "Put"
  expiry: string  // Unix ms timestamp as string
}

// ── API surface ───────────────────────────────────────────────────────────────

export const api = {
  login:  (password: string) => req<{ ok: boolean }>('POST', '/api/login', { password }),
  logout: ()                 => req<{ ok: boolean }>('POST', '/api/logout'),

  status: () => req<BotStatus>('GET', '/api/status'),

  logs: (lines = 300) => req<{ lines: string[] }>('GET', `/api/logs?lines=${lines}`),
  logsStreamUrl: '/api/logs/stream',

  bot: {
    start:   () => req<{ ok: boolean }>('POST', '/api/bot/action', { action: 'start' }),
    stop:    () => req<{ ok: boolean }>('POST', '/api/bot/action', { action: 'stop' }),
    restart: () => req<{ ok: boolean }>('POST', '/api/bot/action', { action: 'restart' }),
  },

  accounts: {
    list:        ()                           => req<Account[]>('GET', '/api/accounts'),
    add:         (a: AccountInput)            => req<{ ok: boolean }>('POST', '/api/accounts', a),
    update:      (i: number, a: AccountInput) => req<{ ok: boolean }>('PUT', `/api/accounts/${i}`, a),
    toggle:      (i: number)                  => req<{ ok: boolean; active: boolean }>('PATCH', `/api/accounts/${i}/toggle`),
    delete:      (i: number)                  => req<{ ok: boolean }>('DELETE', `/api/accounts/${i}`),
    setMaster:   (i: number)                  => req<{ ok: boolean }>('PATCH', `/api/accounts/${i}/set-master`),
    detail:      (i: number)                  => req<AccountDetail>('GET', `/api/portfolio/account/${i}`),
    orders:      (i: number)                  => req<{ orders: unknown[] }>('GET', `/api/accounts/${i}/orders`),
    executions:  (i: number)                  => req<{ executions: ExecutionRecord[]; total_realised_pnl: number }>('GET', `/api/accounts/${i}/executions`),
  },

  settings: {
    get:  ()                 => req<Settings>('GET',  '/api/settings'),
    save: (s: SettingsInput) => req<{ ok: boolean; note: string }>('POST', '/api/settings', s),
  },

  portfolio: {
    balance:    () => req<WalletBalance>('GET', '/api/portfolio/balance'),
    positions:  () => req<{ positions: Position[]; errors: string[] }>('GET', '/api/portfolio/positions'),
    close:      (b: { symbol: string; side: string; size: string; account: string }) =>
                  req<{ ok: boolean; orderId: string }>('POST', '/api/portfolio/close', b),
    placeOrder: (b: { symbol: string; side: string; qty: string; order_type: string; price?: string; account?: string }) =>
                  req<{ ok: boolean; orderId: string }>('POST', '/api/portfolio/place-order', b),
  },

  funds: {
    transferMaster:  (amount: number, direction: 'IN' | 'OUT') =>
                       req<{ ok: boolean; trading_balance: unknown }>('POST', '/api/funds/transfer', { amount, direction }),
    transferAccount: (idx: number, amount: number, direction: 'IN' | 'OUT') =>
                       req<{ ok: boolean; trading_balance: unknown }>('POST', `/api/accounts/${idx}/transfer`, { amount, direction }),
  },

  journal: {
    trades:     () => req<JournalData>('GET', '/api/journal'),
    executions: () => req<ExecutionsData>('GET', '/api/journal/executions'),
  },

  instruments: {
    list: (baseCoin = 'BTC') => req<Instrument[]>('GET', `/api/instruments?baseCoin=${baseCoin}`),
  },
}
