
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
        const [users] = await pool.query('SELECT id, email FROM users');
        const user = (users as any[])[0];

        // Check if user ID is '1' (or short integer string)
        if (user && String(user.id) === '1') {
            console.log('Detected integer User ID: 1. Checking positions...');

            const [positions] = await pool.query('SELECT user_id FROM portfolio_positions LIMIT 1');
            const pos = (positions as any[])[0];

            if (pos && pos.user_id.length > 10) {
                console.log('Detected UUID in positions:', pos.user_id);
                console.log('Migrating users table to CHAR(36) and updating User ID...');

                // 1. Drop AUTO_INCREMENT if exists (modifying column usually does this, but being explicit is good)
                // We just MODIFY the column.
                await pool.query('ALTER TABLE users MODIFY id CHAR(36) NOT NULL');
                console.log('Altered users.id to CHAR(36)');

                // 2. Update the User ID to match the position's user_id
                // Assuming single user ownership for now as discovered
                await pool.query('UPDATE users SET id = ? WHERE id = ?', [pos.user_id, '1']);
                console.log(`Updated user ${user.email} ID from 1 to ${pos.user_id}`);

                console.log('Repair complete. Please log in again.');
            } else {
                console.log('Positions verification failed or also use integer ID. No repair needed?');
            }
        } else {
            console.log('User ID is not 1 (or empty). Skipping repair.');
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

repair();
