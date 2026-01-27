import dotenv from 'dotenv'
import express from 'express'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listReinvestmentExecutions,
  processPortfolioForReinvestment,
  updateReinvestmentRule,
} from './reinvestment'
import {
  createCollectionPlan,
  listCollectionPlans,
  updateCollectionPlan,
  deleteCollectionPlan,
} from './collection_plan'
import { startScheduler } from './scheduler'

// Always load the repo-root `.env` (even if the server is started from `server/`).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

type HoldingRow = {
  id: string
  symbol: string
  shares: number
  dividendPerShare: number
  dividendFrequency: 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'
  includeInReinvestment: boolean
  createdAt: string
}

type PortfolioPositionRow = {
  id: string
  symbol: string
  amount: number
  buyPrice: number | null
  createdAt: string
  updatedAt: string
}

type WatchlistItemRow = {
  id: string
  symbol: string
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

// Railway provides PORT, but we use API_PORT locally
const port = Number(process.env.PORT ?? process.env.API_PORT ?? '5174')

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

async function fetchEodRangeFromEodhd(symbol: string, from: string, to: string): Promise<unknown[]> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(
    eodhdToken,
  )}&fmt=json&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
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

async function fetchFundamentalsFromEodhd(symbol: string): Promise<unknown> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/fundamentals/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(
    eodhdToken,
  )}&fmt=json`
  return await eodhdFetchJson(url)
}

async function fetchExchangeSymbolsFromEodhd(exchange: string): Promise<unknown[]> {
  if (!hasEodhdToken) throw new Error('Missing required env var: EODHD_API_TOKEN')
  const url = `https://eodhd.com/api/exchange-symbol-list/${encodeURIComponent(
    exchange,
  )}?api_token=${encodeURIComponent(eodhdToken)}&fmt=json`
  const rows = await eodhdFetchJson(url)
  return Array.isArray(rows) ? (rows as unknown[]) : []
}

async function getDividendMetadata(symbols: string[]): Promise<
  Record<
    string,
    {
      dividendFrequency: string | null
      dividendPerShare: number | null
    }
  >
> {
  const unique = Array.from(new Set(symbols.map((s) => toSymbol(s)).filter(Boolean)))
  if (unique.length === 0) return {}

  const params: Record<string, unknown> = {}
  const names: string[] = []
  unique.forEach((s, idx) => {
    const key = `s${idx}`
    params[key] = s
    names.push(`:${key}`)
  })

  // 1. Get frequency from eodhd_exchange_symbols
  const [freqRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, dividend_frequency
     FROM eodhd_exchange_symbols
     WHERE symbol IN (${names.join(', ')})`,
    params,
  )

  const out: Record<
    string,
    {
      dividendFrequency: string | null
      dividendPerShare: number | null
    }
  > = {}

  for (const r of freqRows as unknown as Array<{ symbol?: unknown; dividend_frequency?: unknown }>) {
    const s = toSymbol(r.symbol)
    if (s) {
      out[s] = {
        dividendFrequency: typeof r.dividend_frequency === 'string' ? r.dividend_frequency : null,
        dividendPerShare: null,
      }
    }
  }

  // 2. Get latest dividend value from stock_dividends
  const [divRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, value, date
     FROM stock_dividends
     WHERE symbol IN (${names.join(', ')})
     ORDER BY date DESC`,
    params,
  )

  const visitedDiv = new Set<string>()
  for (const r of divRows as unknown as Array<{ symbol?: unknown; value?: unknown; date?: unknown }>) {
    const s = toSymbol(r.symbol)
    if (!s || visitedDiv.has(s)) continue

    visitedDiv.add(s)
    const val = Number(r.value)
    if (!out[s]) {
      out[s] = { dividendFrequency: null, dividendPerShare: null }
    }
    if (Number.isFinite(val)) {
      out[s].dividendPerShare = val
    }
  }

  return out
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
    `CREATE TABLE IF NOT EXISTS portfolio_positions (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      amount DECIMAL(18,6) NOT NULL,
      buy_price DECIMAL(18,6) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_portfolio_user_symbol (user_id, symbol),
      INDEX idx_portfolio_user_updated_at (user_id, updated_at)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS watchlist_items (
      id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_watchlist_user_symbol (user_id, symbol),
      INDEX idx_watchlist_user_created_at (user_id, created_at)
    )`,
  )

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS collection_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      target_stock VARCHAR(16) NOT NULL,
      frequency VARCHAR(16) NOT NULL,
      investment_type VARCHAR(16) NOT NULL DEFAULT 'AMOUNT',
      currency VARCHAR(8) NOT NULL DEFAULT 'USD',
      amount DECIMAL(18,6) NOT NULL,
      auto_deposit TINYINT(1) NOT NULL DEFAULT 1,
      start_date DATE NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_plans_user (user_id),
      INDEX idx_plans_status (status)
    )`,
  )

  // Migrate collection_plans for new columns (Kakao-style)
  const [planCols] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
      SUM(CASE WHEN column_name = 'investment_type' THEN 1 ELSE 0 END) AS hasType,
      SUM(CASE WHEN column_name = 'currency' THEN 1 ELSE 0 END) AS hasCurrency,
      SUM(CASE WHEN column_name = 'auto_deposit' THEN 1 ELSE 0 END) AS hasAutoDeposit
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'collection_plans'`,
  )
  const planFlags = planCols[0] as unknown as { hasType: number; hasCurrency: number; hasAutoDeposit: number }

  if (!Number(planFlags.hasType)) {
    await pool.execute(
      `ALTER TABLE collection_plans ADD COLUMN investment_type VARCHAR(16) NOT NULL DEFAULT 'AMOUNT' AFTER frequency`
    )
  }
  if (!Number(planFlags.hasCurrency)) {
    await pool.execute(
      `ALTER TABLE collection_plans ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'USD' AFTER amount`
    )
  }
  if (!Number(planFlags.hasAutoDeposit)) {
    await pool.execute(
      `ALTER TABLE collection_plans ADD COLUMN auto_deposit TINYINT(1) NOT NULL DEFAULT 1 AFTER currency`
    )
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS eodhd_exchange_symbols (
      exchange VARCHAR(16) NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      name VARCHAR(255) NULL,
      type VARCHAR(24) NULL,
      currency VARCHAR(16) NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (exchange, symbol),
      INDEX idx_eodhd_symbols_exchange_symbol (exchange, symbol),
      INDEX idx_eodhd_symbols_exchange_name (exchange, name)
    )`,
  )

  // Ensure dividend_frequency column exists
  const [eodhdDivFreqCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'eodhd_exchange_symbols'
       AND column_name = 'dividend_frequency'`,
  )
  const hasEodhdDivFreq = Number((eodhdDivFreqCol[0] as { count: number }).count) > 0
  if (!hasEodhdDivFreq) {
    await pool.execute(
      `ALTER TABLE eodhd_exchange_symbols
       ADD COLUMN dividend_frequency VARCHAR(16) NULL AFTER currency`,
    )
  }

  await pool.execute(
    `CREATE TABLE IF NOT EXISTS eodhd_fundamentals (
      symbol VARCHAR(32) NOT NULL,
      payload LONGTEXT NOT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol),
      INDEX idx_eodhd_fund_fetched_at (fetched_at)
    )`,
  )

  // If upgrading from an older schema, add buy_price column if missing.
  const [portfolioBuyPriceCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'portfolio_positions'
       AND column_name = 'buy_price'`,
  )
  const hasBuyPrice = Number((portfolioBuyPriceCol[0] as { count: number }).count) > 0
  if (!hasBuyPrice) {
    await pool.execute(
      `ALTER TABLE portfolio_positions
       ADD COLUMN buy_price DECIMAL(18,6) NULL AFTER amount`,
    )
  }

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
      schedule_mode VARCHAR(24) NOT NULL DEFAULT 'WEEK_OF_MONTH',
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
      adjusted_close DECIMAL(18,6) NULL,
      volume BIGINT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (symbol, date),
      INDEX idx_stock_eod_symbol_date (symbol, date)
    )`,
  )

  // If upgrading from older schema, add adjusted_close if missing.
  const [eodAdjCol] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'stock_eod'
       AND column_name = 'adjusted_close'`,
  )
  const hasAdjustedClose = Number((eodAdjCol[0] as { count: number }).count) > 0
  if (!hasAdjustedClose) {
    await pool.execute(
      `ALTER TABLE stock_eod
       ADD COLUMN adjusted_close DECIMAL(18,6) NULL AFTER close`,
    )
  }

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
      `ALTER TABLE reinvestment_rules ADD COLUMN schedule_mode VARCHAR(24) NOT NULL DEFAULT 'WEEK_OF_MONTH' AFTER destination_assets`,
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

function normalizeWatchlistSymbol(raw: unknown): string {
  const s = toSymbol(raw)
  if (!s) return ''
  // Default to US exchange suffix if the user enters a bare ticker.
  if (s.includes('.')) return s
  return `${s}.US`
}

function toMs(raw: unknown): number | null {
  if (!raw) return null
  if (raw instanceof Date) return raw.getTime()
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : null
}

async function loadStockRealtimeWithMeta(
  symbol: string,
): Promise<{ payload: unknown; fetchedAtMs: number | null } | null> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT payload, fetched_at AS fetchedAt FROM stock_realtime WHERE symbol = :symbol LIMIT 1`,
    { symbol },
  )
  const row = rows[0] as { payload?: unknown; fetchedAt?: unknown } | undefined
  if (!row?.payload) return null

  let payload: unknown = row.payload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }
  if (!payload) return null

  return { payload, fetchedAtMs: toMs(row.fetchedAt) }
}

async function loadFundamentalsWithMeta(
  symbol: string,
): Promise<{ payload: unknown; fetchedAtMs: number | null } | null> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT payload, fetched_at AS fetchedAt FROM eodhd_fundamentals WHERE symbol = :symbol LIMIT 1`,
    { symbol },
  )
  const row = rows[0] as { payload?: unknown; fetchedAt?: unknown } | undefined
  if (!row?.payload) return null

  let payload: unknown = row.payload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }
  if (!payload) return null
  return { payload, fetchedAtMs: toMs(row.fetchedAt) }
}

async function upsertFundamentals(symbol: string, payload: unknown): Promise<void> {
  await pool.execute(
    `INSERT INTO eodhd_fundamentals (symbol, payload, fetched_at)
     VALUES (:symbol, :payload, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
    { symbol, payload: JSON.stringify(payload) },
  )
}

function extractFundamentalsMeta(payload: unknown): {
  name: string | null
  type: string | null
  currency: string | null
} {
  const obj = (payload ?? {}) as Record<string, unknown>
  const general = (obj.General ?? obj.general ?? null) as any
  const name = typeof general?.Name === 'string' ? general.Name : typeof general?.name === 'string' ? general.name : null
  const type = typeof general?.Type === 'string' ? general.Type : typeof general?.type === 'string' ? general.type : null
  const currency =
    typeof general?.CurrencyCode === 'string'
      ? general.CurrencyCode
      : typeof general?.Currency === 'string'
        ? general.Currency
        : typeof general?.currency === 'string'
          ? general.currency
          : null

  return { name, type, currency }
}

function normalizeRealtimeQuote(rt: unknown): {
  price: number | null
  change: number | null
  changePercent: number | null
} {
  const obj = (rt ?? {}) as Record<string, unknown>

  const price =
    typeof obj.close === 'number'
      ? obj.close
      : typeof obj.price === 'number'
        ? obj.price
        : typeof obj.last === 'number'
          ? obj.last
          : null

  const previousClose =
    typeof obj.previousClose === 'number'
      ? obj.previousClose
      : typeof obj.previous_close === 'number'
        ? obj.previous_close
        : null

  let change = typeof obj.change === 'number' ? obj.change : null
  let changePercent =
    typeof obj.change_p === 'number'
      ? obj.change_p
      : typeof obj.changePercent === 'number'
        ? obj.changePercent
        : null

  if (change === null && typeof price === 'number' && typeof previousClose === 'number') {
    change = price - previousClose
  }
  if (changePercent === null && typeof change === 'number' && typeof previousClose === 'number') {
    changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0
  }

  return { price, change, changePercent }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency))
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }).map(async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx] as T, idx)
    }
  })
  await Promise.all(workers)
}

async function ensureExchangeSymbolsCached(exchangeRaw: string, maxAgeMs: number): Promise<void> {
  const exchange = String(exchangeRaw ?? '').trim().toUpperCase() || 'US'
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT MAX(fetched_at) AS lastFetched FROM eodhd_exchange_symbols WHERE exchange = :exchange`,
    { exchange },
  )
  const lastFetched = toMs((rows[0] as any)?.lastFetched)
  const now = Date.now()
  if (lastFetched && now - lastFetched < maxAgeMs) return

  const list = await fetchExchangeSymbolsFromEodhd(exchange)

  await pool.execute(`DELETE FROM eodhd_exchange_symbols WHERE exchange = :exchange`, { exchange })

  const parsed = list
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => {
      const code =
        typeof x.Code === 'string'
          ? x.Code
          : typeof x.code === 'string'
            ? x.code
            : typeof x.Symbol === 'string'
              ? x.Symbol
              : typeof x.symbol === 'string'
                ? x.symbol
                : ''
      const symbol = toSymbol(code)
      const name = typeof x.Name === 'string' ? x.Name : typeof x.name === 'string' ? x.name : null
      const type = typeof x.Type === 'string' ? x.Type : typeof x.type === 'string' ? x.type : null
      const currency =
        typeof x.Currency === 'string'
          ? x.Currency
          : typeof x.currency === 'string'
            ? x.currency
            : null
      return { symbol, name, type, currency }
    })
    .filter((r) => Boolean(r.symbol))

  const chunkSize = 500
  for (let start = 0; start < parsed.length; start += chunkSize) {
    const chunk = parsed.slice(start, start + chunkSize)
    const placeholders = chunk.map(() => '(?,?,?,?,?,CURRENT_TIMESTAMP)').join(',')
    const params: unknown[] = []
    for (const r of chunk) {
      params.push(exchange, r.symbol, r.name, r.type, r.currency)
    }
    await pool.execute(
      `INSERT INTO eodhd_exchange_symbols (exchange, symbol, name, type, currency, fetched_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         type = VALUES(type),
         currency = VALUES(currency),
         fetched_at = VALUES(fetched_at)`,
      params,
    )
  }
}

async function loadExchangeSymbolNames(
  pairs: Array<{ exchange: string; symbol: string }>,
): Promise<Record<string, string>> {
  const grouped = new Map<string, string[]>()
  for (const p of pairs) {
    const exchange = String(p.exchange ?? '').trim().toUpperCase() || 'US'
    const symbol = toSymbol(p.symbol)
    if (!symbol) continue
    const arr = grouped.get(exchange) ?? []
    arr.push(symbol)
    grouped.set(exchange, arr)
  }

  const out: Record<string, string> = {}
  for (const [exchange, list] of grouped) {
    const unique = Array.from(new Set(list)).filter(Boolean)
    if (unique.length === 0) continue

    const params: Record<string, unknown> = { exchange }
    const names: string[] = []
    unique.forEach((s, idx) => {
      const key = `s${idx}`
      params[key] = s
      names.push(`:${key}`)
    })

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol, name
       FROM eodhd_exchange_symbols
       WHERE exchange = :exchange AND symbol IN (${names.join(', ')})`,
      params,
    )

    for (const r of rows as unknown as Array<{ symbol?: unknown; name?: unknown }>) {
      const sym = toSymbol(r.symbol)
      const name = typeof r.name === 'string' ? r.name.trim() : ''
      if (!sym || !name) continue
      out[`${exchange}:${sym}`] = name
    }
  }

  return out
}

async function getRealtimeFetchedAtMs(symbols: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(symbols.map((s) => toSymbol(s)).filter(Boolean)))
  if (unique.length === 0) return {}

  const params: Record<string, unknown> = {}
  const names: string[] = []
  unique.forEach((s, idx) => {
    const key = `s${idx}`
    params[key] = s
    names.push(`:${key}`)
  })

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, fetched_at AS fetchedAt
     FROM stock_realtime
     WHERE symbol IN (${names.join(', ')})`,
    params,
  )

  const out: Record<string, number> = {}
  for (const r of rows as unknown as Array<{ symbol?: unknown; fetchedAt?: unknown }>) {
    const symbol = toSymbol(r.symbol)
    const ms = toMs(r.fetchedAt)
    if (symbol && ms) out[symbol] = ms
  }
  return out
}

async function getFundamentalsFetchedAtMs(symbols: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(symbols.map((s) => toSymbol(s)).filter(Boolean)))
  if (unique.length === 0) return {}

  const params: Record<string, unknown> = {}
  const names: string[] = []
  unique.forEach((s, idx) => {
    const key = `f${idx}`
    params[key] = s
    names.push(`:${key}`)
  })

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, fetched_at AS fetchedAt
     FROM eodhd_fundamentals
     WHERE symbol IN (${names.join(', ')})`,
    params,
  )

  const out: Record<string, number> = {}
  for (const r of rows as unknown as Array<{ symbol?: unknown; fetchedAt?: unknown }>) {
    const symbol = toSymbol(r.symbol)
    const ms = toMs(r.fetchedAt)
    if (symbol && ms) out[symbol] = ms
  }
  return out
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
  adjustedClose: number | null
  volume: number | null
}

async function loadStockEod(symbol: string, limit: number): Promise<StockEodRow[]> {
  const safeLimit = Math.max(1, Math.min(365, Math.floor(limit)))
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        open, high, low, close,
        adjusted_close AS adjustedClose,
        volume
     FROM stock_eod
     WHERE symbol = :symbol
     ORDER BY date DESC
     LIMIT ${safeLimit}`,
    { symbol },
  )
  const parsed = (rows as unknown as StockEodRow[]).filter((r) => Boolean(r?.date))
  return parsed.reverse()
}

type StockEodRangeRow = {
  date: string
  close: number
  adjustedClose: number | null
  volume: number | null
}

async function loadStockEodRange(symbol: string, from: string, to: string): Promise<StockEodRangeRow[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        close,
        adjusted_close AS adjustedClose,
        volume
     FROM stock_eod
     WHERE symbol = :symbol AND date >= :from AND date <= :to
     ORDER BY date ASC`,
    { symbol, from, to },
  )
  return rows as unknown as StockEodRangeRow[]
}

async function shouldRefreshEodRange(symbol: string, from: string, to: string, maxAgeMs: number): Promise<boolean> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        COUNT(*) AS cnt,
        MAX(fetched_at) AS lastFetched
     FROM stock_eod
     WHERE symbol = :symbol AND date >= :from AND date <= :to`,
    { symbol, from, to },
  )
  const row = rows[0] as unknown as { cnt: number; lastFetched: unknown } | undefined
  const cnt = Number(row?.cnt ?? 0)
  if (cnt <= 0) return true
  const last = toMs(row?.lastFetched)
  if (!last) return true
  return Date.now() - last > maxAgeMs
}

async function ensureEodRangeCached(symbol: string, from: string, to: string): Promise<'db' | 'api'> {
  // Cache window: refresh at most once per 24h per symbol+range.
  const needs = await shouldRefreshEodRange(symbol, from, to, 24 * 60 * 60 * 1000)
  if (!needs) return 'db'

  const rows = await fetchEodRangeFromEodhd(symbol, from, to)
  await upsertStockEod(symbol, rows)
  return 'api'
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

    const adjRaw = (r.adjusted_close ?? r.adjustedClose ?? r.adj_close ?? null) as unknown
    const adjustedClose = adjRaw === null || adjRaw === undefined ? null : Number(adjRaw)
    const adjustedCloseSafe =
      adjustedClose !== null && Number.isFinite(adjustedClose) ? adjustedClose : null

    const volumeRaw = r.volume
    const volume = volumeRaw === null || volumeRaw === undefined ? null : Number(volumeRaw)
    const volumeSafe =
      volume !== null && Number.isFinite(volume) ? Math.floor(volume) : null

    await pool.execute(
      `INSERT INTO stock_eod (symbol, date, open, high, low, close, adjusted_close, volume, fetched_at)
       VALUES (:symbol, :date, :open, :high, :low, :close, :adjustedClose, :volume, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         open = VALUES(open),
         high = VALUES(high),
         low = VALUES(low),
         close = VALUES(close),
         adjusted_close = VALUES(adjusted_close),
         volume = VALUES(volume),
         fetched_at = VALUES(fetched_at)`,
      { symbol, date, open, high, low, close, adjustedClose: adjustedCloseSafe, volume: volumeSafe },
    )
  }
}

function isoDateOrNull(v: unknown): string | null {
  return toSqlDate(v)
}

function splitSymbol(symbolWithExchange: string): { symbol: string; exchange: string } {
  const s = toSymbol(symbolWithExchange)
  const parts = s.split('.')
  if (parts.length >= 2) {
    return { symbol: parts.slice(0, -1).join('.'), exchange: parts[parts.length - 1] as string }
  }
  return { symbol: s, exchange: 'US' }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function minMaxNormalize(values: number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return values.map(() => 0)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (max === min) return values.map(() => 0.5)
  return values.map((v) => clamp01((v - min) / (max - min)))
}

function computeMaxDrawdown(closes: number[]): number {
  // Max drawdown is a fraction in [0,1].
  let peak = -Infinity
  let maxDd = 0
  for (const c of closes) {
    if (!Number.isFinite(c) || c <= 0) continue
    if (c > peak) peak = c
    if (peak > 0) {
      const dd = (peak - c) / peak
      if (dd > maxDd) maxDd = dd
    }
  }
  return clamp01(maxDd)
}

function nearestCloseOnOrAfter(points: Array<{ date: string; close: number }>, targetIso: string): number | null {
  for (const p of points) {
    if (p.date >= targetIso) return p.close
  }
  return points.length ? points[0]!.close : null
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

type RecommendedStock = {
  symbol: string
  exchange: string
  name: string
  type: 'STOCK' | 'ETF'
  price: number
  score: number
  reason: string
}

function computeRecommendationsFromEod(
  items: Array<{
    symbol: string
    exchange: string
    name: string | null
    type: 'STOCK' | 'ETF'
    price: number | null
    dividendFlag: 0 | 1
    avgVolume: number
    maxDrawdown: number
    return3m: number
  }>,
): RecommendedStock[] {
  const returnN = minMaxNormalize(items.map((x) => x.return3m))
  const ddN = minMaxNormalize(items.map((x) => x.maxDrawdown))
  const volN = minMaxNormalize(items.map((x) => x.avgVolume))

  const out: RecommendedStock[] = items.map((x, i) => {
    const score =
      returnN[i]! * 0.4 - ddN[i]! * 0.3 + volN[i]! * 0.2 + x.dividendFlag * 0.1

    const reasonParts = [
      `3M return ${(x.return3m * 100).toFixed(2)}%`,
      `1Y max drawdown ${(x.maxDrawdown * 100).toFixed(2)}%`,
      `avg volume ${Math.round(x.avgVolume).toLocaleString()}`,
    ]
    if (x.dividendFlag) reasonParts.push('dividends detected')

    const name = x.name?.trim() ? x.name.trim() : x.symbol

    return {
      symbol: x.symbol,
      exchange: x.exchange,
      name,
      type: x.type,
      price: typeof x.price === 'number' ? x.price : NaN,
      score: Number(score.toFixed(6)),
      reason: reasonParts.join(', '),
    }
  })

  return out
    .filter((x) => Number.isFinite(x.price))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
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
        UNION
        SELECT symbol FROM portfolio_positions
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

    const [freqRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT dividend_frequency FROM eodhd_exchange_symbols WHERE symbol = :symbol LIMIT 1',
      { symbol },
    )
    const dividendFrequency = (freqRows[0] as { dividend_frequency?: string } | undefined)?.dividend_frequency ?? null

    res.json({ symbol, source, realtime, eod, dividends, dividendFrequency })
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



app.get('/api/holdings', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    // Accrue dividends + run scheduled reinvestment deterministically on reads.
    await processPortfolioForReinvestment(pool, user.id)

    // 1. Fetch real portfolio positions
    const [portfolioRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        id,
        symbol,
        amount
       FROM portfolio_positions
       WHERE user_id = :userId`,
      { userId: user.id },
    )
    const portfolioPositions = portfolioRows as unknown as { id: number; symbol: string; amount: string }[]

    // 2. Fetch configured holding metadata
    // We only care about dividend_per_share, dividend_frequency, include_in_reinvestment from here
    // IF we match a portfolio position.
    // IF we don't match, we might want to still show it (manual holding not in portfolio)? 
    // For now, let's show EVERYTHING: Union of Portfolio and Manual Holdings.
    const [holdingRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        dividend_per_share AS dividendPerShare,
        dividend_frequency AS dividendFrequency,
        include_in_reinvestment AS includeInReinvestment,
        created_at AS createdAt
      FROM holdings
      WHERE user_id = :userId`,
      { userId: user.id },
    )
    const storedHoldings = holdingRows as unknown as HoldingRow[]

    // Map by symbol for easy lookup
    const holdingMap = new Map<string, HoldingRow>()
    for (const h of storedHoldings) {
      holdingMap.set(toSymbol(h.symbol), h)
    }

    const combined: HoldingRow[] = []
    const processedSymbols = new Set<string>()

    // Collect all portfolio symbols to fetch metadata
    const neededSymbols = new Set<string>()
    for (const p of portfolioPositions) {
      neededSymbols.add(toSymbol(p.symbol))
    }
    const divMetadata = await getDividendMetadata(Array.from(neededSymbols))

    // Priority 1: Portfolio Positions
    for (const p of portfolioPositions) {
      const sym = toSymbol(p.symbol)
      const matched = holdingMap.get(sym)
      if (matched) {
        // Exists in both. Use Holding ID (UUID) for editing, but Portfolio Amount for shares.
        combined.push({
          ...matched,
          shares: Number(p.amount), // Override with real amount
          includeInReinvestment: Boolean((matched as any).includeInReinvestment),
        })
      } else {
        // Only in Portfolio. Create a "virtual" holding.
        const meta = divMetadata[sym]
        let frequency: any = 'yearly' // Default
        if (meta?.dividendFrequency) {
          const lower = meta.dividendFrequency.toLowerCase()
          if (
            lower === 'weekly' ||
            lower === 'monthly' ||
            lower === 'quarterly' ||
            lower === 'half-yearly' ||
            lower === 'yearly'
          ) {
            frequency = lower
          }
        }

        combined.push({
          id: String(p.id), // INT ID (stringified)
          symbol: sym,
          shares: Number(p.amount),
          dividendPerShare: meta?.dividendPerShare ?? 0,
          dividendFrequency: frequency,
          includeInReinvestment: true,
          createdAt: new Date().toISOString(), // Mock
        })
      }
    }

    // Priority 2: Manual Holdings (that are NOT in portfolio)
    // Keep them? User might want to plan for things they don't own yet.
    for (const h of storedHoldings) {
      const sym = toSymbol(h.symbol)
      if (!processedSymbols.has(sym)) {
        combined.push({
          ...h,
          includeInReinvestment: Boolean((h as any).includeInReinvestment),
        })
      }
    }

    combined.sort((a, b) => b.shares * a.dividendPerShare - b.shares * b.dividendPerShare) // Rough sort by income? Or just symbol?
    // Let's keep existing sort: created_at desc? 
    // Virtual ones have fake created_at. Let's just sort by Symbol?
    // Or just default push order (Portfolio first, then manual).

    res.json({
      holdings: combined,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
  }
})

app.get('/api/portfolio', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        id,
        symbol,
        amount,
        buy_price AS buyPrice,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM portfolio_positions
      WHERE user_id = :userId
      ORDER BY updated_at DESC, created_at DESC`,
      { userId: user.id },
    )
    console.log(`[API] GET /portfolio userId=${user.id} returned ${rows.length} rows`)

    res.json({
      positions: (rows as unknown as PortfolioPositionRow[]).map((r) => ({
        ...r,
        symbol: toSymbol(r.symbol),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.post('/api/portfolio', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const symbol = toSymbol(req.body?.symbol)
    const amount = Number(req.body?.amount)
    const buyPriceRaw = req.body?.buyPrice
    const buyPrice = buyPriceRaw === undefined || buyPriceRaw === null || buyPriceRaw === ''
      ? null
      : Number(buyPriceRaw)

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' })
      return
    }

    if (buyPrice !== null && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
      res.status(400).json({ error: 'Buy price must be a positive number' })
      return
    }



    try {
      const [result] = await pool.execute<mysql.ResultSetHeader>(
        `INSERT INTO portfolio_positions (
          user_id,
          symbol,
          amount,
          buy_price
        ) VALUES (
          :userId,
          :symbol,
          :amount,
          :buyPrice
        )`,
        { userId: user.id, symbol, amount, buyPrice },
      )

      const insertId = result.insertId

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT
          id,
          symbol,
          amount,
          buy_price AS buyPrice,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM portfolio_positions
        WHERE id = :id AND user_id = :userId`,
        { id: insertId, userId: user.id },
      )

      const position = rows[0] as unknown as PortfolioPositionRow | undefined
      res.status(201).json({
        position: position ? { ...position, symbol: toSymbol(position.symbol) } : undefined,
      })
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'Symbol already exists in your portfolio' })
        return
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.patch('/api/portfolio/:id', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const id = String(req.params.id ?? '').trim()
    if (!id) {
      res.status(400).json({ error: 'Missing id' })
      return
    }

    const patchAmount = req.body?.amount
    const patchBuyPrice = req.body?.buyPrice

    const updates: string[] = []
    const params: Record<string, unknown> = { id, userId: user.id }

    if (patchAmount !== undefined) {
      const amount = Number(patchAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: 'Amount must be a positive number' })
        return
      }
      updates.push('amount = :amount')
      params.amount = amount
    }

    if (patchBuyPrice !== undefined) {
      if (patchBuyPrice === null || patchBuyPrice === '') {
        updates.push('buy_price = NULL')
      } else {
        const buyPrice = Number(patchBuyPrice)
        if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
          res.status(400).json({ error: 'Buy price must be a positive number' })
          return
        }
        updates.push('buy_price = :buyPrice')
        params.buyPrice = buyPrice
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    const [result] = await pool.execute<mysql.ResultSetHeader>(
      `UPDATE portfolio_positions
       SET ${updates.join(', ')}
       WHERE id = :id AND user_id = :userId`,
      params,
    )

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Position not found' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        id,
        symbol,
        amount,
        buy_price AS buyPrice,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM portfolio_positions
      WHERE id = :id AND user_id = :userId`,
      { id, userId: user.id },
    )

    const position = rows[0] as unknown as PortfolioPositionRow | undefined
    res.json({
      position: position ? { ...position, symbol: toSymbol(position.symbol) } : undefined,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/portfolio/cash', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      'SELECT cash_balance FROM portfolio_summary WHERE user_id = :userId',
      { userId: user.id },
    )

    const balance = rows.length > 0 ? Number(rows[0].cash_balance) : 0
    res.json({ cashBalance: balance })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.put('/api/portfolio/cash', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const { amount } = req.body
    if (typeof amount !== 'number' || isNaN(amount)) {
      res.status(400).json({ error: 'Invalid amount' })
      return
    }

    await pool.execute(
      `INSERT INTO portfolio_summary (user_id, cash_balance)
       VALUES (:userId, :amount)
       ON DUPLICATE KEY UPDATE cash_balance = VALUES(cash_balance)`,
      { userId: user.id, amount },
    )

    res.json({ cashBalance: amount })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.delete('/api/portfolio/:id', async (req, res) => {
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

    const [result] = await pool.execute<mysql.ResultSetHeader>(
      'DELETE FROM portfolio_positions WHERE id = :id AND user_id = :userId',
      { id, userId: user.id },
    )

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Position not found' })
      return
    }

    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
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
      dividendFrequency !== 'quarterly' &&
      dividendFrequency !== 'half-yearly' &&
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
      scheduleMode: String(req.body?.scheduleMode ?? 'WEEK_OF_MONTH') as any,
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

// Collection Plans Routes
app.post('/api/plans', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return }
    const plan = await createCollectionPlan(pool, user.id, req.body)
    res.json(plan)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/plans', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return }
    const plans = await listCollectionPlans(pool, user.id)
    res.json({ plans })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.patch('/api/plans/:id', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return }
    await updateCollectionPlan(pool, user.id, req.params.id, req.body)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.delete('/api/plans/:id', async (req, res) => {
  try {
    const user = readSession(req)
    if (!user) { res.status(401).json({ error: 'Not authenticated' }); return }
    await deleteCollectionPlan(pool, user.id, req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
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

app.get('/api/watchlist', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT
        w.id,
        w.symbol,
        w.created_at AS createdAt,
        f.payload AS fundamentalsPayload,
        rt.payload AS realtimePayload
      FROM watchlist_items w
      LEFT JOIN eodhd_fundamentals f ON f.symbol = w.symbol
      LEFT JOIN stock_realtime rt ON rt.symbol = w.symbol
      WHERE w.user_id = :userId
      ORDER BY w.created_at DESC`,
      { userId: user.id },
    )

    const items = (rows as unknown as Array<
      WatchlistItemRow & { fundamentalsPayload?: unknown; realtimePayload?: unknown }
    >).map((r) => {
      const symbol = toSymbol(r.symbol)

      let fundamentals: unknown = r.fundamentalsPayload
      if (typeof fundamentals === 'string') {
        try {
          fundamentals = JSON.parse(fundamentals)
        } catch {
          fundamentals = null
        }
      }
      const meta = extractFundamentalsMeta(fundamentals)

      let realtime: unknown = r.realtimePayload
      if (typeof realtime === 'string') {
        try {
          realtime = JSON.parse(realtime)
        } catch {
          realtime = null
        }
      }
      const q = normalizeRealtimeQuote(realtime)

      return {
        id: r.id,
        symbol,
        createdAt: r.createdAt,
        name: meta.name,
        type: meta.type,
        currency: meta.currency,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
      }
    })

    res.json({ items })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.post('/api/watchlist', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const symbol = normalizeWatchlistSymbol(req.body?.symbol)
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }

    const id = randomUUID()
    try {
      await pool.execute(
        `INSERT INTO watchlist_items (id, user_id, symbol)
         VALUES (:id, :userId, :symbol)`,
        { id, userId: user.id, symbol },
      )
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'ER_DUP_ENTRY') {
        res.status(409).json({ error: 'Symbol already exists in your watchlist' })
        return
      }
      throw err
    }

    // Warm fundamentals cache (best-effort).
    try {
      const fund = await fetchFundamentalsFromEodhd(symbol)
      await upsertFundamentals(symbol, fund)
    } catch {
      // ignore
    }

    res.status(201).json({ id, symbol })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.delete('/api/watchlist/:symbol', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const symbol = normalizeWatchlistSymbol(req.params.symbol)
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol' })
      return
    }

    const [result] = await pool.execute<mysql.ResultSetHeader>(
      `DELETE FROM watchlist_items WHERE user_id = :userId AND symbol = :symbol`,
      { userId: user.id, symbol },
    )

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Watchlist item not found' })
      return
    }

    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/watchlist/search', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const q = toSymbol(req.query.q)
    if (!q) {
      res.json({ symbols: [] })
      return
    }

    const exchange = String(req.query.exchange ?? 'US').trim().toUpperCase() || 'US'
    const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit ?? '10'))))

    // Cache symbol list ~7 days.
    await ensureExchangeSymbolsCached(exchange, 7 * 24 * 60 * 60 * 1000)

    const like = `${q}%`
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol
       FROM eodhd_exchange_symbols
       WHERE exchange = :exchange AND symbol LIKE :like
       ORDER BY symbol
       LIMIT ${limit}`,
      { exchange, like },
    )

    const symbols = (rows as unknown as Array<{ symbol?: unknown }>).map((r) => toSymbol(r.symbol)).filter(Boolean)
    res.json({ symbols })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

// ---------------------------------------------------------------------------
// EODHD symbol list (cached): public endpoints for browsing/searching.
// - GET /api/symbols/search?q=TSL&exchange=US&limit=10
// - GET /api/symbols?q=TESLA&exchange=US&limit=100&offset=0
// ---------------------------------------------------------------------------

app.get('/api/symbols/search', async (req, res) => {
  try {
    await ensureSchema()

    const q = toSymbol(req.query.q)
    if (!q) {
      res.json({ symbols: [] })
      return
    }

    const exchange = String(req.query.exchange ?? 'US').trim().toUpperCase() || 'US'
    const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit ?? '10'))))

    // Cache symbol list ~7 days, but avoid hard failing if token is missing.
    if (hasEodhdToken) {
      await ensureExchangeSymbolsCached(exchange, 7 * 24 * 60 * 60 * 1000)
    }

    const like = `${q}%`
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol
       FROM eodhd_exchange_symbols
       WHERE exchange = :exchange AND symbol LIKE :like
       ORDER BY symbol
       LIMIT ${limit}`,
      { exchange, like },
    )

    const symbols = (rows as unknown as Array<{ symbol?: unknown }>).map((r) => toSymbol(r.symbol)).filter(Boolean)
    res.json({ symbols })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.get('/api/symbols', async (req, res) => {
  try {
    await ensureSchema()

    const exchange = String(req.query.exchange ?? 'US').trim().toUpperCase() || 'US'
    const qRaw = String(req.query.q ?? '').trim()
    const q = qRaw.toUpperCase()

    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit ?? '100'))))
    const offset = Math.max(0, Math.min(50_000, Math.floor(Number(req.query.offset ?? '0'))))

    // Cache symbol list ~7 days, but avoid hard failing if token is missing.
    if (hasEodhdToken) {
      await ensureExchangeSymbolsCached(exchange, 7 * 24 * 60 * 60 * 1000)
    }

    const where: string[] = ['exchange = :exchange']
    const params: Record<string, unknown> = { exchange }

    if (q) {
      // Symbol prefix match; name substring match.
      where.push('(symbol LIKE :symLike OR name LIKE :nameLike)')
      params.symLike = `${q}%`
      params.nameLike = `%${q}%`
    }

    const [countRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM eodhd_exchange_symbols
       WHERE ${where.join(' AND ')}`,
      params,
    )
    const total = Number((countRows as any)?.[0]?.total ?? 0)

    // Fetch one extra to compute hasMore without relying on total.
    const effectiveLimit = limit + 1
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol, name, type, currency
       FROM eodhd_exchange_symbols
       WHERE ${where.join(' AND ')}
       ORDER BY symbol
       LIMIT ${effectiveLimit} OFFSET ${offset}`,
      params,
    )

    const parsed = (rows as unknown as Array<{ symbol?: unknown; name?: unknown; type?: unknown; currency?: unknown }>).map(
      (r) => ({
        symbol: toSymbol(r.symbol),
        name: typeof r.name === 'string' ? r.name : r.name == null ? null : String(r.name),
        type: typeof r.type === 'string' ? r.type : r.type == null ? null : String(r.type),
        currency: typeof r.currency === 'string' ? r.currency : r.currency == null ? null : String(r.currency),
      }),
    )

    const hasMore = parsed.length > limit
    const items = hasMore ? parsed.slice(0, limit) : parsed
    res.json({ exchange, q: qRaw, limit, offset, total, hasMore, items })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

// ---------------------------------------------------------------------------
// FEATURE 1: Historical EOD chart data (EODHD only)
// GET /api/eod/{symbol}.{exchange}?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------

app.get('/api/eod/:symbol', async (req, res) => {
  try {
    await ensureSchema()

    const symbol = normalizeWatchlistSymbol(req.params.symbol)
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }

    const from = isoDateOrNull(req.query.from)
    const to = isoDateOrNull(req.query.to)
    if (!from || !to) {
      res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' })
      return
    }

    const source = await ensureEodRangeCached(symbol, from, to)
    const rows = await loadStockEodRange(symbol, from, to)

    // Adjusted close preferred; fall back to close.
    const points = rows
      .filter((r) => typeof r.date === 'string')
      .map((r) => {
        const close =
          typeof r.adjustedClose === 'number'
            ? r.adjustedClose
            : typeof r.close === 'number'
              ? r.close
              : null
        return close === null ? null : { date: r.date, close }
      })
      .filter(Boolean)

    res.json({ symbol, from, to, source, points })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

// ---------------------------------------------------------------------------
// FEATURE 2: Rule-based recommendations (EODHD only)
// ---------------------------------------------------------------------------

app.get('/api/recommendations', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)

    // Candidate universe (deterministic + explainable):
    // - If logged-in: user's watchlist.
    // - If logged-out: globally cached symbols (no extra EODHD calls).
    let symbols: string[] = []
    if (user) {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT symbol FROM watchlist_items WHERE user_id = :userId ORDER BY created_at DESC`,
        { userId: user.id },
      )
      symbols = (rows as unknown as Array<{ symbol?: unknown }>).map((r) => toSymbol(r.symbol)).filter(Boolean)
    } else {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT symbol
         FROM stock_eod
         GROUP BY symbol
         ORDER BY MAX(fetched_at) DESC
         LIMIT 40`,
      )
      symbols = (rows as unknown as Array<{ symbol?: unknown }>).map((r) => toSymbol(r.symbol)).filter(Boolean)
    }

    if (symbols.length === 0) {
      res.json({ items: [] })
      return
    }

    // Best-effort: map symbol -> name using the cached exchange list (same source as /symbols).
    // For logged-out users we do not trigger remote EODHD calls here.
    const namePairs = symbols.map((full) => splitSymbol(full))
    const exchangeNameMap = await loadExchangeSymbolNames(namePairs)

    const today = new Date()
    const toIso = today.toISOString().slice(0, 10)
    const fromIso = addMonthsIso(toIso, -12)
    const from3mIso = addMonthsIso(toIso, -3)

    const now = Date.now()

    // Logged-in users: we can fetch missing data with gentle pacing.
    if (user) {
      // Ensure required EOD data exists in cache.
      await mapWithConcurrency(symbols, 2, async (s, idx) => {
        if (idx > 0) await sleep(220)
        await ensureEodRangeCached(s, fromIso, toIso)
      })

      // Fundamentals (dividends/type/name) are slower; fetch only if missing/stale (~30d).
      const fundFetched = await getFundamentalsFetchedAtMs(symbols)
      const fundMaxAgeMs = 30 * 24 * 60 * 60 * 1000
      const fundToFetch = symbols.filter((s) => !fundFetched[s] || now - fundFetched[s]! > fundMaxAgeMs)
      await mapWithConcurrency(fundToFetch, 1, async (s, idx) => {
        if (idx > 0) await sleep(300)
        const f = await fetchFundamentalsFromEodhd(s)
        await upsertFundamentals(s, f)
      })

      // Quotes refresh (best-effort): keep realtime relatively fresh for logged-in views.
      const rtFetched = await getRealtimeFetchedAtMs(symbols)
      const rtMaxAgeMs = 5 * 60 * 1000
      const rtToFetch = symbols.filter((s) => !rtFetched[s] || now - rtFetched[s]! > rtMaxAgeMs)
      await mapWithConcurrency(rtToFetch, 2, async (s, idx) => {
        if (idx > 0) await sleep(200)
        const rt = await fetchRealTimeFromEodhd(s)
        await upsertStockRealtime(s, rt)
      })
    }

    const enriched: Array<{
      symbol: string
      exchange: string
      name: string | null
      type: 'STOCK' | 'ETF'
      price: number | null
      dividendFlag: 0 | 1
      avgVolume: number
      maxDrawdown: number
      return3m: number
    }> = []

    for (const fullSymbol of symbols) {
      const split = splitSymbol(fullSymbol)
      const exchange = split.exchange
      const baseSymbol = split.symbol

      const eodRows = await loadStockEodRange(fullSymbol, fromIso, toIso)
      const points = eodRows
        .map((r) => {
          const close =
            typeof r.adjustedClose === 'number'
              ? r.adjustedClose
              : typeof r.close === 'number'
                ? r.close
                : null
          return close === null || !r.date ? null : { date: r.date, close }
        })
        .filter(Boolean) as Array<{ date: string; close: number }>

      if (points.length < 10) continue

      const lastClose = points[points.length - 1]!.close
      const close3m = nearestCloseOnOrAfter(points, from3mIso)
      const return3m = close3m && close3m !== 0 ? lastClose / close3m - 1 : 0

      const maxDrawdown = computeMaxDrawdown(points.map((p) => p.close))

      const vols = eodRows
        .map((r) => r.volume)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      const avgVolume = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0

      const fund = await loadFundamentalsWithMeta(fullSymbol)
      const meta = extractFundamentalsMeta(fund?.payload ?? null)
      const nameFromList = exchangeNameMap[`${exchange}:${toSymbol(baseSymbol)}`]
      const name = nameFromList || meta.name || null

      // Dividend preference: use fundamentals when available.
      const fundObj = (fund?.payload ?? {}) as any
      const general = fundObj?.General ?? fundObj?.general ?? null
      const rawType = typeof general?.Type === 'string' ? general.Type : typeof general?.type === 'string' ? general.type : ''
      const type: 'STOCK' | 'ETF' = String(rawType).toLowerCase() === 'etf' || fundObj?.ETF_Data ? 'ETF' : 'STOCK'

      const dividendYield =
        typeof fundObj?.ETF_Data?.DividendYield === 'number'
          ? fundObj.ETF_Data.DividendYield
          : typeof fundObj?.Highlights?.DividendYield === 'number'
            ? fundObj.Highlights.DividendYield
            : typeof fundObj?.highlights?.dividendYield === 'number'
              ? fundObj.highlights.dividendYield
              : null
      const dividendFlag: 0 | 1 = dividendYield !== null && Number.isFinite(dividendYield) && dividendYield > 0 ? 1 : 0

      const rtRow = await loadStockRealtimeWithMeta(fullSymbol)
      const q = normalizeRealtimeQuote(rtRow?.payload ?? null)
      const price = typeof q.price === 'number' ? q.price : lastClose

      enriched.push({
        symbol: fullSymbol,
        exchange,
        name,
        type,
        price,
        dividendFlag,
        avgVolume,
        maxDrawdown,
        return3m,
      })
    }

    const items = computeRecommendationsFromEod(enriched)
    res.json({ items })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

app.post('/api/watchlist/refresh', async (req, res) => {
  try {
    await ensureSchema()
    const user = readSession(req)
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT symbol FROM watchlist_items WHERE user_id = :userId ORDER BY created_at DESC`,
      { userId: user.id },
    )
    const symbols = (rows as unknown as Array<{ symbol?: unknown }>).map((r) => toSymbol(r.symbol)).filter(Boolean)

    const now = Date.now()
    const realtimeFetched = await getRealtimeFetchedAtMs(symbols)
    const maxAgeMs = 60 * 1000
    const staleQuotes = symbols.filter((s) => {
      const ms = realtimeFetched[s]
      return !ms || now - ms > maxAgeMs
    })

    await mapWithConcurrency(staleQuotes, 2, async (s, idx) => {
      // Gentle pacing to avoid bursts.
      if (idx > 0) await sleep(250)
      const rt = await fetchRealTimeFromEodhd(s)
      await upsertStockRealtime(s, rt)
    })

    // Fundamentals: keep ~30 days.
    const fundFetched = await getFundamentalsFetchedAtMs(symbols)
    const fundMaxAgeMs = 30 * 24 * 60 * 60 * 1000
    const staleFund = symbols.filter((s) => {
      const ms = fundFetched[s]
      return !ms || now - ms > fundMaxAgeMs
    })
    await mapWithConcurrency(staleFund, 1, async (s, idx) => {
      if (idx > 0) await sleep(300)
      const f = await fetchFundamentalsFromEodhd(s)
      await upsertFundamentals(s, f)
    })

    res.json({
      symbols: symbols.length,
      refreshedQuotes: staleQuotes.length,
      refreshedFundamentals: staleFund.length,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

// Serve static files from Vite build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')

  console.log(`Serving static files from: ${distPath}`)

  // Serve static assets
  app.use(express.static(distPath))

  // SPA fallback: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    // Skip API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' })
    }
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

const init = async () => {
  try {
    await ensureSchema()
    app.listen(port, '0.0.0.0', () => {
      console.log(`API listening on http://localhost:${port}`)
      startScheduler(pool)
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

init()
