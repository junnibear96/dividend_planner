import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? '3306'),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    })

    try {
        console.log('Creating portfolio_summary table...')
        await pool.execute(`
      CREATE TABLE IF NOT EXISTS portfolio_summary (
        user_id CHAR(36) NOT NULL,
        cash_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id)
      )
    `)
        console.log('Success.')
    } catch (err) {
        console.error('Failed:', err)
        process.exit(1)
    } finally {
        await pool.end()
    }
}

run()
