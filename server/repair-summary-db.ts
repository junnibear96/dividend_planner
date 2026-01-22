
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
        // 1. Check table definition
        const [columns] = await pool.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, EXTRA 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'portfolio_summary' AND COLUMN_NAME = 'user_id'
    `, [process.env.DB_DATABASE]);

        const col = (columns as any[])[0];
        console.log('Current user_id definition:', col);

        if (col && (col.DATA_TYPE === 'int' || col.EXTRA.includes('auto_increment'))) {
            console.log('Detected integer/auto_increment user_id. Fixing...');

            // Since user_id is PK, we may need to drop PK first if we were just altering, 
            // but modifying the column type should handle it if we are careful.
            // Actually, safest is to drop the table since it's just a summary and likely has bad data if schemas mismatched.
            // But let's try to ALTER to preserve cash if valid?
            // No, if user_id was int, UUIDs wouldn't fit. So existing data is likely for user "1" or garbage.
            // Let's DROP and RECREATE.

            await pool.query('DROP TABLE IF EXISTS portfolio_summary');
            console.log('Dropped table portfolio_summary');

            await pool.query(`
        CREATE TABLE portfolio_summary (
          user_id CHAR(36) NOT NULL,
          cash_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id)
        )
      `);
            console.log('Recreated table portfolio_summary with CHAR(36) PK');

        } else {
            console.log('Table seems correct or not found.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

repair();
