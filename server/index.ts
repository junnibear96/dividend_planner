import 'dotenv/config'
import express from 'express'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import {
  listReinvestmentExecutions,
  processPortfolioForReinvestment,
  updateReinvestmentRule,
} from './reinvestment'

type HoldingRow = {
  id: string
  symbol: string
  shares: number
  dividendPerShare: number
  dividendFrequency: 'weekly' | 'monthly' | 'yearly'
  includeInReinvestment: boolean
  createdAt: string
}


function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function toSymbol(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

function toSqlDate(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

const app = express()
app.use(cookieParser())
app.use(express.json())

const port = Number(process.env.API_PORT ?? '5174')

const pool = mysql.createPool({
  host: requireEnv('DB_HOST'),
  port: Number(process.env.DB_PORT ?? '3306'),
  user: requireEnv('DB_USER'),
  password: process.env.DB_PASSWORD ?? '',
  database: requireEnv('DB_DATABASE'),
  connectionLimit: Number(process.env.DB_POOL_SIZE ?? '10'),
  namedPlaceholders: true,
  decimalNumbers: true,
})

const jwtSecret = requireEnv('AUTH_JWT_SECRET')
const eodhdToken = process.env.EODHD_API_TOKEN ?? ''
const hasEodhdToken = Boolean(eodhdToken)

function redactEodhdUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    if (u.searchParams.has('api_token')) {
      u.searchParams.set('api_token', 'REDACTED')
    }
    return u.toString()
  } catch {
    return rawUrl.replace(/api_token=([^&]+)/i, 'api_token=REDACTED')
  }
}

async function eodhdFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`EODHD request failed (${res.status}) for ${redactEodhdUrl(url)}`)
  }
  return (await res.json()) as unknown
}

async function fetchRealTimeFromEodhd(symbol: string): Promise<unknown> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(
    eodhdToken,
  )}&fmt=json`
  return await eodhdFetchJson(url)
}

async function fetchEodFromEodhd(symbol: string, limit: number): Promise<unknown[]> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(
    eodhdToken,
  )}&fmt=json&limit=${encodeURIComponent(String(limit))}`
  const rows = await eodhdFetchJson(url)
  return Array.isArray(rows) ? (rows as unknown[]) : []
}

async function fetchDividendsFromEodhd(symbol: string): Promise<unknown[]> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/div/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(
    eodhdToken,
  )}&fmt=json`
  const rows = await eodhdFetchJson(url)
  return Array.isArray(rows) ? (rows as unknown[]) : []
}

async function ensureSchema() {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_users_email (email)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS holdings (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      symbol VARCHAR(16) NOT NULL,
      shares DECIMAL(18,6) NOT NULL,
      dividend_per_share DECIMAL(18,6) NOT NULL,
      dividend_frequency VARCHAR(16) NOT NULL,
      include_in_reinvestment TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_holdings_user_created_at (user_id, created_at),
      INDEX idx_holdings_created_at (created_at)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS dividend_accruals (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      symbol VARCHAR(16) NOT NULL,
      amount DECIMAL(18,6) NOT NULL,
      accrual_date DATE NOT NULL,
      frequency VARCHAR(16) NOT NULL,
      consumed_execution_id CHAR(36) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_accruals_user_date (user_id, accrual_date),
      INDEX idx_accruals_user_symbol (user_id, symbol),
      INDEX idx_accruals_user_consumed (user_id, consumed_execution_id)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS dividend_cash_pool (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      available_balance DECIMAL(18,6) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_cash_pool_user (user_id)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS reinvestment_rules (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      enabled TINYINT(1) NOT NULL,
      source_scope VARCHAR(16) NOT NULL,
      destination_type VARCHAR(32) NOT NULL,
      destination_assets JSON NOT NULL,
      schedule_mode VARCHAR(24) NOT NULL DEFAULT 'FIXED',
      frequency VARCHAR(16) NOT NULL,
      week_destinations JSON NULL,
      minimum_amount DECIMAL(18,6) NOT NULL,
      fractional_shares_allowed TINYINT(1) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_rules_user_updated (user_id, updated_at)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS reinvestment_executions (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      rule_id CHAR(36) NOT NULL,
      execution_date DATE NOT NULL,
      week_index TINYINT NULL,
      total_amount DECIMAL(18,6) NOT NULL,
      execution_details JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_exec_user_date (user_id, execution_date),
      INDEX idx_exec_user_week (user_id, week_index, execution_date),
      INDEX idx_exec_rule_date (rule_id, execution_date)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS stock_realtime (
      symbol VARCHAR(32) NOT NULL,
      payload LONGTEXT NOT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol),
      INDEX idx_stock_realtime_fetched_at (fetched_at)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS stock_eod (
      symbol VARCHAR(32) NOT NULL,
      date DATE NOT NULL,
      open DECIMAL(18,6) NOT NULL,
      high DECIMAL(18,6) NOT NULL,
      low DECIMAL(18,6) NOT NULL,
      close DECIMAL(18,6) NOT NULL,
      volume BIGINT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol, date),
      INDEX idx_stock_eod_symbol_date (symbol, date)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS stock_dividends (
      symbol VARCHAR(32) NOT NULL,
      date DATE NOT NULL,
      value DECIMAL(18,6) NOT NULL,
      currency VARCHAR(8) NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol, date),
      INDEX idx_stock_div_symbol_date (symbol, date)
    )`,
  )

  // If upgrading from an older schema, add user_id column/index if missing.
  const [colRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'holdings'
       AND column_name = 'user_id'`,
  )
  const hasUserId = Number((colRows[0] as { count: number }).count) > 0
  if (!hasUserId) {
    await pool.execute(`ALTER TABLE holdings ADD COLUMN user_id CHAR(36) NULL AFTER id`)
    await pool.execute(
      `CREATE INDEX idx_holdings_user_created_at ON holdings (user_id, created_at)`,
    )

    const [cntRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN user_id IS NULL OR user_id = '' THEN 1 ELSE 0 END) AS missing
       FROM holdings`,
    )
    const total = Number((cntRows[0] as { total: number }).total)
    const missing = Number((cntRows[0] as { missing: number }).missing)
    if (total === 0 || missing === 0) {
      await pool.execute(`ALTER TABLE holdings MODIFY user_id CHAR(36) NOT NULL`)
    }
  }

  // Migrate reinvestment rules for week-of-month scheduling.
  const [ruleScheduleCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'reinvestment_rules'
       AND column_name = 'schedule_mode'`,
  )
  const hasScheduleMode = Number((ruleScheduleCol[0] as { count: number }).count) > 0
  if (!hasScheduleMode) {
    await pool.execute(
      `ALTER TABLE reinvestment_rules ADD COLUMN schedule_mode VARCHAR(24) NOT NULL DEFAULT 'FIXED' AFTER destination_assets`,
    )
  }

  const [ruleWeekDestCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'reinvestment_rules'
       AND column_name = 'week_destinations'`,
  )
  const hasWeekDest = Number((ruleWeekDestCol[0] as { count: number }).count) > 0
  if (!hasWeekDest) {
    await pool.execute(
      `ALTER TABLE reinvestment_rules ADD COLUMN week_destinations JSON NULL AFTER frequency`,
    )
  }

  const [execWeekIdxCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'reinvestment_executions'
       AND column_name = 'week_index'`,
  )
  const hasWeekIndex = Number((execWeekIdxCol[0] as { count: number }).count) > 0
  if (!hasWeekIndex) {
    await pool.execute(
      `ALTER TABLE reinvestment_executions ADD COLUMN week_index TINYINT NULL AFTER execution_date`,
    )
    await pool.execute(
      `CREATE INDEX idx_exec_user_week ON reinvestment_executions (user_id, week_index, execution_date)`,
    )
  }

  // If upgrading from an older schema, add dividend columns if missing.
  const [divColRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
      SUM(CASE WHEN column_name = 'dividend_per_share' THEN 1 ELSE 0 END) AS hasDividendPerShare,
      SUM(CASE WHEN column_name = 'dividend_frequency' THEN 1 ELSE 0 END) AS hasDividendFrequency,
      SUM(CASE WHEN column_name = 'annual_dividend_per_share' THEN 1 ELSE 0 END) AS hasAnnualDividend
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'holdings'
       AND column_name IN ('dividend_per_share','dividend_frequency','annual_dividend_per_share')`,
  )
  const divFlags = divColRows[0] as unknown as {
    hasDividendPerShare: number
    hasDividendFrequency: number
    hasAnnualDividend: number
  }
  const hasDividendPerShare = Number(divFlags.hasDividendPerShare) > 0
  const hasDividendFrequency = Number(divFlags.hasDividendFrequency) > 0
  const hasAnnualDividend = Number(divFlags.hasAnnualDividend) > 0

  if (!hasDividendPerShare) {
    await pool.execute(
      `ALTER TABLE holdings
       ADD COLUMN dividend_per_share DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER shares`,
    )
  }

  // If upgrading from an older schema, add include_in_reinvestment if missing.
  const [incRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'holdings'
       AND column_name = 'include_in_reinvestment'`,
  )
  const hasIncludeInReinvestment = Number((incRows[0] as { count: number }).count) > 0
  if (!hasIncludeInReinvestment) {
    await pool.execute(
      `ALTER TABLE holdings
       ADD COLUMN include_in_reinvestment TINYINT(1) NOT NULL DEFAULT 1 AFTER dividend_frequency`,
    )
  }
  if (!hasDividendFrequency) {
    await pool.execute(
      `ALTER TABLE holdings
       ADD COLUMN dividend_frequency VARCHAR(16) NOT NULL DEFAULT 'yearly' AFTER dividend_per_share`,
    )
  }

  // Backfill from legacy annual_dividend_per_share if present.
  if (hasAnnualDividend) {
    // Legacy schema had annual_dividend_per_share as NOT NULL with no default.
    // Our new inserts no longer write this column, so ensure it has a default.
    await pool.execute(
      `ALTER TABLE holdings
       MODIFY COLUMN annual_dividend_per_share DECIMAL(18,6) NOT NULL DEFAULT 0`,
    )

    await pool.execute(
      `UPDATE holdings
       SET dividend_per_share = annual_dividend_per_share
       WHERE dividend_per_share = 0`,
    )
  }
  await pool.execute(
    `UPDATE holdings
     SET dividend_frequency = 'yearly'
     WHERE dividend_frequency IS NULL OR dividend_frequency = ''`,
  )
}

async function loadStockRealtime(symbol: string): Promise<unknown | null> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT payload FROM stock_realtime WHERE symbol = :symbol LIMIT 1`,
    { symbol },
  )
  const row = rows[0] as { payload?: unknown } | undefined
  if (!row?.payload) return null
  if (typeof row.payload === 'string') {
    try {
      return JSON.parse(row.payload)
    } catch {
      return null
    }
  }
  return row.payload
}

async function upsertStockRealtime(symbol: string, payload: unknown): Promise<void> {
  await pool.execute(
    `INSERT INTO stock_realtime (symbol, payload, fetched_at)
     VALUES (:symbol, :payload, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
    { symbol, payload: JSON.stringify(payload) },
  )
}

type StockEodRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

async function loadStockEod(symbol: string, limit: number): Promise<StockEodRow[]> {
  const safeLimit = Math.max(1, Math.min(365, Math.floor(limit)))
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        open, high, low, close, volume
     FROM stock_eod
     WHERE symbol = :symbol
     ORDER BY date DESC
     LIMIT ${safeLimit}`,
    { symbol },
  )
  const parsed = (rows as unknown as StockEodRow[]).filter((r) => Boolean(r?.date))
  return parsed.reverse()
}

async function upsertStockEod(symbol: string, rows: unknown[]): Promise<void> {
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>
    const date = toSqlDate(r.date)
    if (!date) continue

    const open = Number(r.open)
    const high = Number(r.high)
    const low = Number(r.low)
    const close = Number(r.close)
    if (![open, high, low, close].every((v) => Number.isFinite(v))) continue

    const volumeRaw = r.volume
    const volume = volumeRaw === null || volumeRaw === undefined ? null : Number(volumeRaw)
    const volumeSafe =
      volume !== null && Number.isFinite(volume) ? Math.floor(volume) : null

    await pool.execute(
      `INSERT INTO stock_eod (symbol, date, open, high, low, close, volume, fetched_at)
       VALUES (:symbol, :date, :open, :high, :low, :close, :volume, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         open = VALUES(open),
         high = VALUES(high),
         low = VALUES(low),
         close = VALUES(close),
         volume = VALUES(volume),
         fetched_at = VALUES(fetched_at)`,
      { symbol, date, open, high, low, close, volume: volumeSafe },
    )
  }
}

type StockDividendRow = {
  date: string
  value: number
  currency: string | null
}

async function loadStockDividends(symbol: string, limit: number): Promise<StockDividendRow[]> {
  const safeLimit = Math.max(1, Math.min(2000, Math.floor(limit)))
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        value,
        currency
     FROM stock_dividends
     WHERE symbol = :symbol
     ORDER BY date DESC
     LIMIT ${safeLimit}`,
    { symbol },
  )
  return rows as unknown as StockDividendRow[]
}

async function upsertStockDividends(symbol: string, rows: unknown[]): Promise<void> {
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>
    const date = toSqlDate(r.date)
    if (!date) continue

    const value = Number(r.value)
    if (!Number.isFinite(value)) continue

    const currency = typeof r.currency === 'string' ? r.currency : null

    await pool.execute(
      `INSERT INTO stock_dividends (symbol, date, value, currency, fetched_at)
       VALUES (:symbol, :date, :value, :currency, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         value = VALUES(value),
         currency = VALUES(currency),
         fetched_at = VALUES(fetched_at)`,
      { symbol, date, value, currency },
    )
  }
}

type SessionUser = {
  id: string
  email: string
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
  }
}

function signSession(user: SessionUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '7d',
  })
}

function readSession(req: express.Request): SessionUser | null {
  const token = String(req.cookies?.session ?? '')
  if (!token) return null
  try {
    const payload = jwt.verify(token, jwtSecret) as { sub?: string; email?: string }
    if (!payload.sub || !payload.email) return null
    return { id: payload.sub, email: payload.email }
  } catch {
    return null
  }
}


app.get('/api/health', async (_req, res) => {
  try {
    await ensureSchema()
    await pool.query('SELECT 1 AS ok')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.get('/api/stocks/symbols', async (req, res) => {
  try {
    await ensureSchema()

    const q = toSymbol(req.query.q)
    if (!q) {
      res.json({ symbols: [] })
      return
    }

    const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit ?? '10'))))
    const like = `${q}%`

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol FROM (
        SELECT symbol FROM stock_realtime
        UNION
        SELECT symbol FROM stock_eod
        UNION
        SELECT symbol FROM stock_dividends
        UNION
        SELECT symbol FROM holdings
      ) AS s
      WHERE symbol LIKE :like
      ORDER BY symbol
      LIMIT ${limit}`,
      { like },
    )

    const symbols = (rows as unknown as { symbol?: unknown }[])
      .map((r) => toSymbol(r.symbol))
      .filter(Boolean)
    res.json({ symbols })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/stocks/:symbol', async (req, res) => {
  try {
    await ensureSchema()

    const symbol = toSymbol(req.params.symbol)
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }

    const limit = Number(req.query.limit ?? '30')
    const dividendsLimit = Number(req.query.divLimit ?? '400')

    const source: {
      realtime: 'db' | 'api'
      eod: 'db' | 'api'
      dividends: 'db' | 'api'
    } = { realtime: 'db', eod: 'db', dividends: 'db' }

    let realtime = await loadStockRealtime(symbol)
    let eod = await loadStockEod(symbol, limit)
    let dividends = await loadStockDividends(symbol, dividendsLimit)

    if (!hasEodhdToken) {
      const missing: string[] = []
      if (!realtime) missing.push('realtime')
      if (eod.length === 0) missing.push('eod')
      if (dividends.length === 0) missing.push('dividends')
      if (missing.length > 0) {
        res.status(503).json({
          error:
            `Missing EODHD_API_TOKEN (server env). Cannot fetch: ${missing.join(', ')}. ` +
            `Set EODHD_API_TOKEN or request a symbol already cached in DB.`,
        })
        return
      }
    }

    if (!realtime) {
      const rt = await fetchRealTimeFromEodhd(symbol)
      await upsertStockRealtime(symbol, rt)
      source.realtime = 'api'
      realtime = await loadStockRealtime(symbol)
    }

    if (eod.length === 0) {
      const rows = await fetchEodFromEodhd(symbol, Math.max(1, Math.min(365, Math.floor(limit))))
      await upsertStockEod(symbol, rows)
      source.eod = 'api'
      eod = await loadStockEod(symbol, limit)
    }

    if (dividends.length === 0) {
      const rows = await fetchDividendsFromEodhd(symbol)
      await upsertStockDividends(symbol, rows)
      source.dividends = 'api'
      dividends = await loadStockDividends(symbol, dividendsLimit)
    }

    res.json({ symbol, source, realtime, eod, dividends })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/auth/me', async (req, res) => {
  const user = readSession(req)
  if (!user) {
    res.status(401).json({ user: null })
    return
  }
  res.json({ user })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    await ensureSchema()
    const email = String(req.body?.email ?? '')
      .trim()
      .toLowerCase()
    const password = String(req.body?.password ?? '')

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' })
      return
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' })
      return
    }

    const existing = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id FROM users WHERE email = :email LIMIT 1',
      { email },
    )
    if (existing[0].length > 0) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    const id = randomUUID()
    const passwordHash = await bcrypt.hash(password, 12)

    await pool.execute(
      'INSERT INTO users (id, email, password_hash) VALUES (:id, :email, :passwordHash)',
      { id, email, passwordHash },
    )

    const user: SessionUser = { id, email }
    res.cookie('session', signSession(user), getCookieOptions())
    res.status(201).json({ user })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureSchema()
    const email = String(req.body?.email ?? '')
      .trim()
      .toLowerCase()
    const password = String(req.body?.password ?? '')

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id, email, password_hash FROM users WHERE email = :email LIMIT 1',
      { email },
    )
    const row = rows[0] as { id: string; email: string; password_hash: string } | undefined
    if (!row) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const user: SessionUser = { id: row.id, email: row.email }
    res.cookie('session', signSession(user), getCookieOptions())
    res.json({ user })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('session', { path: '/' })
  res.status(204).end()
})

app.get('/api/holdings', async (_req, res) => {
  try {
    await ensureSchema()
    const user = readSession(_req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    // Accrue dividends + run scheduled reinvestment deterministically on reads.
    await processPortfolioForReinvestment(pool, user.id)
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        dividend_per_share AS dividendPerShare,
        dividend_frequency AS dividendFrequency,
        include_in_reinvestment AS includeInReinvestment,
        created_at AS createdAt
      FROM holdings
      WHERE user_id = :userId
      ORDER BY created_at DESC`,
      { userId: user.id },
    )

    const holdings = (rows as unknown as HoldingRow[]).map((h) => ({
      ...h,
      includeInReinvestment: Boolean(
        (h as unknown as { includeInReinvestment: unknown }).includeInReinvestment,
      ),
    }))

    res.json({
      holdings,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.post('/api/holdings', async (req, res) => {
  try {
    await ensureSchema()
    // Require login for writes
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    const symbol = String(req.body?.symbol ?? '')
      .trim()
      .toUpperCase()
    const shares = Number(req.body?.shares)
    const dividendPerShare = Number(req.body?.dividendPerShare)
    const dividendFrequency = String(req.body?.dividendFrequency ?? '').trim().toLowerCase()
    const includeInReinvestment = req.body?.includeInReinvestment

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      res.status(400).json({ error: 'Shares must be a positive number' })
      return
    }
    if (!Number.isFinite(dividendPerShare) || dividendPerShare <= 0) {
      res.status(400).json({ error: 'Dividend/share must be a positive number' })
      return
    }
    if (
      dividendFrequency !== 'weekly' &&
      dividendFrequency !== 'monthly' &&
      dividendFrequency !== 'yearly'
    ) {
      res.status(400).json({ error: 'Dividend frequency must be weekly, monthly, or yearly' })
      return
    }

    const id = randomUUID()

    const includeValue = includeInReinvestment === undefined ? 1 : Boolean(includeInReinvestment) ? 1 : 0

    await pool.execute(
      `INSERT INTO holdings (
        id,
        user_id,
        symbol,
        shares,
        dividend_per_share,
        dividend_frequency,
        include_in_reinvestment
      )
       VALUES (
        :id,
        :userId,
        :symbol,
        :shares,
        :dividendPerShare,
        :dividendFrequency,
        :includeInReinvestment
      )`,
      {
        id,
        userId: user.id,
        symbol,
        shares,
        dividendPerShare,
        dividendFrequency,
        includeInReinvestment: includeValue,
      },
    )

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        dividend_per_share AS dividendPerShare,
        dividend_frequency AS dividendFrequency,
        include_in_reinvestment AS includeInReinvestment,
        created_at AS createdAt
      FROM holdings
      WHERE id = :id AND user_id = :userId`,
      { id, userId: user.id },
    )

    const holding = rows[0] as unknown as HoldingRow | undefined
    res.status(201).json({
      holding: holding
        ? {
            ...holding,
            includeInReinvestment: Boolean(
              (holding as unknown as { includeInReinvestment: unknown }).includeInReinvestment,
            ),
          }
        : undefined,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.patch('/api/holdings/:id', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const id = String(req.params.id)
    if (!id) {
      res.status(400).json({ error: 'Missing id' })
      return
    }

    const patchShares = req.body?.shares
    const patchDividend = req.body?.dividendPerShare
    const patchInclude = req.body?.includeInReinvestment

    const updates: string[] = []
    const params: Record<string, unknown> = { id, userId: user.id }

    if (patchShares !== undefined) {
      const shares = Number(patchShares)
      if (!Number.isFinite(shares) || shares <= 0) {
        res.status(400).json({ error: 'Shares must be a positive number' })
        return
      }
      updates.push('shares = :shares')
      params.shares = shares
    }

    if (patchDividend !== undefined) {
      const dividendPerShare = Number(patchDividend)
      if (!Number.isFinite(dividendPerShare) || dividendPerShare < 0) {
        res.status(400).json({ error: 'Dividend/share must be a non-negative number' })
        return
      }
      updates.push('dividend_per_share = :dividendPerShare')
      params.dividendPerShare = dividendPerShare
    }

    if (patchInclude !== undefined) {
      const include = Boolean(patchInclude)
      updates.push('include_in_reinvestment = :includeInReinvestment')
      params.includeInReinvestment = include ? 1 : 0
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    const [result] = await pool.execute<mysql.ResultSetHeader>(
      `UPDATE holdings
       SET ${updates.join(', ')}
       WHERE id = :id AND user_id = :userId`,
      params,
    )

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Holding not found' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        dividend_per_share AS dividendPerShare,
        dividend_frequency AS dividendFrequency,
        include_in_reinvestment AS includeInReinvestment,
        created_at AS createdAt
      FROM holdings
      WHERE id = :id AND user_id = :userId`,
      { id, userId: user.id },
    )

    const holding = rows[0] as unknown as HoldingRow | undefined
    res.json({
      holding: holding
        ? {
            ...holding,
            includeInReinvestment: Boolean(
              (holding as unknown as { includeInReinvestment: unknown }).includeInReinvestment,
            ),
          }
        : undefined,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.get('/api/reinvestment/summary', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const processed = await processPortfolioForReinvestment(pool, user.id)
    res.json({
      dividendCashAvailable: processed.pool.availableBalance,
      nextReinvestmentDate: processed.nextReinvestmentDate,
      rule: processed.rule,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.put('/api/reinvestment/rule', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const rule = await updateReinvestmentRule(pool, user.id, {
      enabled: Boolean(req.body?.enabled),
      sourceScope: String(req.body?.sourceScope ?? 'ALL') as any,
      destinationType: String(req.body?.destinationType ?? 'SAME_AS_SOURCE') as any,
      destinationAssets: Array.isArray(req.body?.destinationAssets)
        ? (req.body.destinationAssets as any)
        : [],
      scheduleMode: String(req.body?.scheduleMode ?? 'FIXED') as any,
      frequency: String(req.body?.frequency ?? 'weekly') as any,
      weekDestinations:
        req.body?.weekDestinations && typeof req.body.weekDestinations === 'object'
          ? (req.body.weekDestinations as any)
          : undefined,
      minimumAmount: Number(req.body?.minimumAmount ?? 0),
      fractionalSharesAllowed: Boolean(req.body?.fractionalSharesAllowed),
    })

    const processed = await processPortfolioForReinvestment(pool, user.id)
    res.json({
      rule,
      nextReinvestmentDate: processed.nextReinvestmentDate,
      dividendCashAvailable: processed.pool.availableBalance,
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bad request' })
  }
})

app.get('/api/reinvestment/history', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    await processPortfolioForReinvestment(pool, user.id)
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit ?? '50'))))
    const executions = await listReinvestmentExecutions(pool, user.id, limit)
    res.json({ executions })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.delete('/api/holdings/:id', async (req, res) => {
  try {
    await ensureSchema()
    // Require login for writes
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    const id = String(req.params.id)
    if (!id) {
      res.status(400).json({ error: 'Missing id' })
      return
    }

    const [result] = await pool.execute<mysql.ResultSetHeader>(
      'DELETE FROM holdings WHERE id = :id AND user_id = :userId',
      { id, userId: user.id },
    )
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Holding not found' })
      return
    }
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
