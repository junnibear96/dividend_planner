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

        // List all tables in the database
        const [tables] = await pool.query<mysql.RowDataPacket[]>(
            `SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY table_name`,
        )

        console.log('\nAll tables in database:')
        if (tables.length === 0) {
            console.log('  ⚠️  NO TABLES FOUND!')
        } else {
            for (const t of tables as unknown as Array<{ name: string }>) {
                console.log(`  - ${t.name}`)
            }
            console.log(`\nTotal: ${tables.length} tables`)
        }

        // Expected tables from schema
        const expectedTables = [
            'users',
            'holdings',
            'portfolio_positions',
            'watchlist_items',
            'collection_plans',
            'eodhd_exchange_symbols',
            'eodhd_fundamentals',
            'dividend_accruals',
            'dividend_cash_pool',
            'reinvestment_rules',
            'reinvestment_executions',
            'stock_realtime',
            'stock_eod',
            'stock_dividends',
        ]

        const existingTables = new Set(
            (tables as unknown as Array<{ name: string }>).map((t) => t.name),
        )
        const missingTables = expectedTables.filter((t) => !existingTables.has(t))

        if (missingTables.length > 0) {
            console.log('\n⚠️  Missing tables:')
            for (const t of missingTables) {
                console.log(`  - ${t}`)
            }
            console.log('\nRun "npm run db:setup" to create all tables.')
        } else {
            console.log('\n✅ All expected tables exist!')
        }
    } finally {
        await pool.end()
    }
}

main().catch((err) => {
    console.error('DB check failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
})
