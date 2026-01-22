
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

async function repair() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        namedPlaceholders: true,
    });

    try {
        console.log('Forcing drop of portfolio_summary...');
        await pool.query('DROP TABLE IF EXISTS portfolio_summary');
        console.log('Dropped.');

        console.log('Recreating portfolio_summary...');
        await pool.query(`
        CREATE TABLE portfolio_summary (
          user_id CHAR(36) NOT NULL,
          cash_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id)
        )
      `);
        console.log('Reated table portfolio_summary successfully.');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

repair();
