import 'dotenv/config'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

async function resetPassword() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    })

    try {
        const email = 'test@gmail.com'
        const newPassword = 'password123'
        const salt = await bcrypt.genSalt(10)
        const hash = await bcrypt.hash(newPassword, salt)

        const [res] = await pool.execute(
            'UPDATE users SET password_hash = ? WHERE email = ?',
            [hash, email]
        )

        console.log(`Reset password for ${email} to "${newPassword}". Result:`, res)
    } catch (err) {
        console.error('Error resetting password:', err)
    } finally {
        await pool.end()
    }
}

resetPassword()
