
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

async function check() {
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
        const [users] = await pool.query('SELECT id, email FROM users');
        const [grouped] = await pool.query('SELECT user_id, COUNT(*) as count FROM portfolio_positions GROUP BY user_id');
        const [sample] = await pool.query('SELECT id, user_id, symbol FROM portfolio_positions LIMIT 5');

        const output = {
            users,
            positionsByUser: grouped,
            samplePositions: sample
        };

        fs.writeFileSync('server/debug-output.txt', JSON.stringify(output, null, 2));
        console.log('Wrote output to server/debug-output.txt');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

check();
