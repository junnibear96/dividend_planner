import 'dotenv/config'
import mysql from 'mysql2/promise'

async function checkUsers() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    })

    try {
        const [rows] = await pool.query('SELECT id, email FROM users')
        console.log(JSON.stringify(rows, null, 2))
    } catch (err) {
        console.error('Error:', err)
    } finally {
        await pool.end()
    }
}

checkUsers()
