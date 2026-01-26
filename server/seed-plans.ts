
import * as mysql from 'mysql2/promise'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function seed() {
    console.log('Seeding collection plans...')
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    })

    try {
        await pool.execute(
            `INSERT INTO collection_plans 
            (user_id, target_stock, frequency, investment_type, currency, amount, status, start_date) 
            VALUES 
            ('user123', 'AAPL', 'daily', 'AMOUNT', 'USD', 10, 'ACTIVE', NOW())`
        )
        console.log('Seeding complete!')
    } catch (err) {
        console.error('Seeding failed:', err)
    } finally {
        await pool.end()
    }
}

seed()
