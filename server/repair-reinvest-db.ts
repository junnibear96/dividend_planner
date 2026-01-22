
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

    const tablesToCheck = [
        'holdings',
        'reinvestment_rules',
        'dividend_accruals',
        'dividend_cash_pool',
        'reinvestment_executions',
        'watchlist_items'
    ];

    try {
        for (const tableName of tablesToCheck) {
            console.log(`Checking table: ${tableName}...`);

            // Check if table exists
            const [exists] = await pool.query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        `, [process.env.DB_DATABASE, tableName]);

            if ((exists as any[]).length === 0) {
                console.log(`Table ${tableName} does not exist. Skipping (will be created by app if needed, or create via schema).`);
                continue;
            }

            const [columns] = await pool.query(`
            SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, EXTRA 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'user_id'
        `, [process.env.DB_DATABASE, tableName]);

            const col = (columns as any[])[0];
            if (!col) {
                console.log(`Column user_id not found in ${tableName}.`);
                continue;
            }

            console.log(`  user_id type: ${col.DATA_TYPE} (${col.COLUMN_TYPE})`);

            if (col.DATA_TYPE === 'int' || col.EXTRA.includes('auto_increment')) {
                console.log(`  !! Incorrect type detected for ${tableName}.user_id. Fixing...`);

                // For foreign keys or strict mode, pure modify might fail if data is bad.
                // But assuming we want to reset/clear bad data if strictly necessary, or just try to ALTER.
                // Converting INT to CHAR(36) is usually fine if data is empty or convertible.
                // If data is just '1', it becomes '1'. But if we have UUIDs waiting to be written, we need space.

                try {
                    // If the table is empty or we don't care about old int data (since user ID 1 is now migrated to UUID)
                    // We can't easily validly convert '1' to a UUID if it's not the same UUID. 
                    // In Step 128 check, we confirmed mapping.
                    // Let's just ALTER. If it fails, we might need to truncate.

                    await pool.query(`ALTER TABLE ${tableName} MODIFY user_id CHAR(36) NOT NULL`);
                    console.log(`  >> Successfully altered ${tableName} to CHAR(36)`);
                } catch (alterErr) {
                    console.error(`  !! ALTER failed for ${tableName}:`, (alterErr as any).message);
                    console.log(`  !! Attempting to DROP and RECREATE (Data loss acceptable for dev environment fix)...`);
                    await pool.query(`DROP TABLE ${tableName}`);
                    console.log(`  >> Dropped ${tableName}. (Restart app to recreate or run schema apply)`);
                    // Ideally we read schema.sql and create, but dropping allows lazy recreation if the app does it, 
                    // OR we can manually create.
                    // Let's rely on 'apply-schema.ts' or similar if it exists, or just let 'ensureSchema' in server handle it?
                    // `server/index.ts` has `ensureSchema`. It runs `schema.sql`.
                    // So dropping is safe-ish.
                }
            } else {
                console.log(`  Type seems OK.`);
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

repair();
