import 'dotenv/config'
import mysql from 'mysql2/promise'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

async function main() {
  const pool = mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? '3306'),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: requireEnv('DB_DATABASE'),
    connectionLimit: 2,
    namedPlaceholders: true,
    decimalNumbers: true,
  })

  try {
    const [infoRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT VERSION() AS version, DATABASE() AS db, USER() AS user',
    )
    const info = infoRows[0] as { version: string; db: string; user: string } | undefined
    console.log('DB connection: OK')
    if (info) {
      console.log(`- version: ${info.version}`)
      console.log(`- database: ${info.db}`)
      console.log(`- user: ${info.user}`)
    }

    // Ensure tables exist
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
    }

    const [tables] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('users','holdings')
       ORDER BY table_name`,
    )

    console.log('Tables:')
    for (const t of tables as unknown as Array<{ name: string }>) {
      console.log(`- ${t.name}: OK`)
    }
    if (tables.length !== 2) {
      console.log('⚠️  One or more tables missing (creation attempted above).')
    }

    const [userCountRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM users',
    )
    const [holdingCountRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM holdings',
    )
    console.log('Row counts:')
    console.log(`- users: ${(userCountRows[0] as { count: number }).count}`)
    console.log(`- holdings: ${(holdingCountRows[0] as { count: number }).count}`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('DB check failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
