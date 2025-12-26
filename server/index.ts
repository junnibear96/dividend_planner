import 'dotenv/config'
import express from 'express'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

type HoldingRow = {
  id: string
  symbol: string
  shares: number
  annualDividendPerShare: number
  createdAt: string
}


function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
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
      annual_dividend_per_share DECIMAL(18,6) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_holdings_user_created_at (user_id, created_at),
      INDEX idx_holdings_created_at (created_at)
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
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        annual_dividend_per_share AS annualDividendPerShare,
        created_at AS createdAt
      FROM holdings
      WHERE user_id = :userId
      ORDER BY created_at DESC`,
      { userId: user.id },
    )

    res.json({
      holdings: rows as unknown as HoldingRow[],
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
    const annualDividendPerShare = Number(req.body?.annualDividendPerShare)

    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required' })
      return
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      res.status(400).json({ error: 'Shares must be a positive number' })
      return
    }
    if (!Number.isFinite(annualDividendPerShare) || annualDividendPerShare <= 0) {
      res
        .status(400)
        .json({ error: 'Annual dividend/share must be a positive number' })
      return
    }

    const id = randomUUID()

    await pool.execute(
      `INSERT INTO holdings (id, user_id, symbol, shares, annual_dividend_per_share)
       VALUES (:id, :userId, :symbol, :shares, :annualDividendPerShare)`,
      { id, userId: user.id, symbol, shares, annualDividendPerShare },
    )

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT 
        id,
        symbol,
        shares,
        annual_dividend_per_share AS annualDividendPerShare,
        created_at AS createdAt
      FROM holdings
      WHERE id = :id AND user_id = :userId`,
      { id, userId: user.id },
    )

    const holding = rows[0] as unknown as HoldingRow | undefined
    res.status(201).json({ holding })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' })
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
