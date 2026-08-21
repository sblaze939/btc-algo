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
  is_master: boolean
  api_key_masked: string
  days_until_expiry: number | null
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
  current_expiry: string
  signal_mode: string
  alert_chat_id: string
  source_channel_id: string
  api_key_validity_days: number
  api_key_set: boolean
  api_key_expires: string
  master_days_until_expiry: number | null
}

export interface SettingsInput {
  dry_run: boolean
  live_from: string
  current_expiry: string
  signal_mode: string
  alert_chat_id: string
  source_channel_id: string
  api_key_validity_days: number
  bot_token: string
  cs_api_key: string
  cs_api_secret: string
}

export interface WalletBalance {
  currency: string        // INR or USDT, as returned by CoinSwitch
  equity: number
  wallet_balance: number
  unrealised_pnl: number
  margin_used?: number
  margin_rate?: number    // 0–1 fraction, e.g. 0.25 = 25% margin used
  available?: number
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
  manual?: boolean
}

export interface AccountDetail {
  wallet: WalletBalance
  positions: Position[]
}

export interface OpenOrder {
  account:     string
  orderId:     string
  orderLinkId: string
  symbol:      string
  side:        string
  orderType:   string
  qty:         string
  price:       string
  orderStatus: string
  createdTime: string
}

export interface SymbolMatch {
  symbol:   string
  ask:      string
  bid:      string
  mark:     string
  iv:       string
  ask_size: string
}

export interface PlaceOrderInput {
  symbol:      string
  side:        'Buy' | 'Sell'
  qty:         string
  order_type:  'Market' | 'Limit'
  price?:      string
  reduce_only?: boolean
}

export interface ManualPosition {
  id:        string
  account:   string
  symbol:    string
  side:      string
  size:      string
  avg_price: string
  markPrice: string
  manual:    true
  createdAt: string
}

export interface MismatchAccount {
  account_idx: number
  account: string
  missing: Position[]   // positions master has that this child is missing
  error: string | null
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
    list:       ()                          => req<Account[]>('GET', '/api/accounts'),
    add:        (a: AccountInput)           => req<{ ok: boolean }>('POST', '/api/accounts', a),
    update:     (i: number, a: AccountInput) => req<{ ok: boolean }>('PUT', `/api/accounts/${i}`, a),
    toggle:     (i: number)                 => req<{ ok: boolean; active: boolean }>('PATCH', `/api/accounts/${i}/toggle`),
    setMaster:  (i: number)                 => req<{ ok: boolean; previous_master: string | null }>('PATCH', `/api/accounts/${i}/set-master`),
    delete:     (i: number)                 => req<{ ok: boolean }>('DELETE', `/api/accounts/${i}`),
    detail:     (i: number)                 => req<AccountDetail>('GET', `/api/portfolio/account/${i}`),
    orders:     (i: number)                 => req<{ orders: OpenOrder[] }>('GET', `/api/accounts/${i}/orders`),
    executions: (i: number)                 => req<ExecutionsData>('GET', `/api/accounts/${i}/executions`),
    placeOrder: (i: number, o: PlaceOrderInput) =>
                  req<{ ok: boolean; dry_run: boolean; orderId: string | null; note?: string }>('POST', `/api/accounts/${i}/place-order`, o),
  },

  market: {
    symbols: (strike: number, option_type: 'C' | 'P') =>
      req<{ symbols: SymbolMatch[] }>('GET', `/api/market/symbols?strike=${strike}&option_type=${option_type}`),
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
    orders:     () => req<{ orders: OpenOrder[]; errors: string[] }>('GET', '/api/portfolio/orders'),
    cancelOrder: (b: { symbol: string; order_id: string; account: string }) =>
                  req<{ ok: boolean; orderId: string }>('POST', '/api/portfolio/orders/cancel', b),
    manualPositions: {
      list:   () => req<{ positions: ManualPosition[] }>('GET', '/api/portfolio/positions/manual'),
      add:    (p: { account: string; symbol: string; side: string; size: string; avg_price: string }) =>
                req<{ ok: boolean; id: string }>('POST', '/api/portfolio/positions/manual', p),
      remove: (id: string) => req<{ ok: boolean }>('DELETE', `/api/portfolio/positions/manual/${id}`),
    },
  },

  mismatch: {
    get:  () => req<{ mismatches: MismatchAccount[] }>('GET', '/api/portfolio/mismatch'),
    sync: (b: { account_idx: number; symbol: string; side: string; size: string }) =>
            req<{ ok: boolean; orderId?: string; error?: string }>('POST', '/api/portfolio/sync-position', b),
  },

  journal: {
    trades:     () => req<JournalData>('GET', '/api/journal'),
    executions: () => req<ExecutionsData>('GET', '/api/journal/executions'),
  },

  funds: {
    transferForAccount: (idx: number, direction: 'IN' | 'OUT', amount: number) =>
      req<{ ok: boolean; transfer_result: unknown; trading_balance: WalletBalance }>(
        'POST', `/api/accounts/${idx}/transfer`, { direction, amount }
      ),
  },
}
