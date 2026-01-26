
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'dividend_planner',
};

async function main() {
    console.log('Connecting to database...');
    const connection = await mysql.createConnection(dbConfig);

    try {
        // 1. Add column if not exists
        console.log('Ensuring dividend_frequency column exists in eodhd_exchange_symbols...');
        await connection.execute(`
      ALTER TABLE eodhd_exchange_symbols
      ADD COLUMN IF NOT EXISTS dividend_frequency VARCHAR(16) NULL
    `);

        // 2. Get all symbols with dividends
        console.log('Fetching symbols with dividend history...');
        const [rows]: any[] = await connection.execute(`
      SELECT DISTINCT symbol FROM stock_dividends
    `);

        console.log(`Found ${rows.length} symbols to analyze.`);

        let updatedCount = 0;

        for (const row of rows) {
            const symbol = row.symbol;

            // Get last 12 dividends
            // We need date to calculate intervals
            const [dividends]: any[] = await connection.execute(`
        SELECT date FROM stock_dividends 
        WHERE symbol = ? 
        ORDER BY date DESC 
        LIMIT 12
      `, [symbol]);

            if (dividends.length < 2) {
                continue;
            }

            // Calculate average interval
            let totalDays = 0;
            let intervals = 0;

            for (let i = 0; i < dividends.length - 1; i++) {
                const date1 = new Date(dividends[i].date);
                const date2 = new Date(dividends[i + 1].date);
                const diffTime = Math.abs(date1.getTime() - date2.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                totalDays += diffDays;
                intervals++;
            }

            const avgInterval = totalDays / intervals;
            let frequency = null;

            if (avgInterval >= 5 && avgInterval <= 14) {
                frequency = 'Weekly';
            } else if (avgInterval >= 25 && avgInterval <= 35) {
                frequency = 'Monthly';
            } else if (avgInterval >= 80 && avgInterval <= 100) {
                frequency = 'Quarterly';
            } else if (avgInterval >= 170 && avgInterval <= 195) {
                frequency = 'Half-yearly';
            } else if (avgInterval >= 350 && avgInterval <= 380) {
                frequency = 'Yearly';
            }

            if (frequency) {
                // Try exact match first
                let [result]: any = await connection.execute(`
          UPDATE eodhd_exchange_symbols 
          SET dividend_frequency = ? 
          WHERE symbol = ?
        `, [frequency, symbol]);

                if (result.affectedRows === 0 && symbol.endsWith('.US')) {
                    const shortSymbol = symbol.replace(/\.US$/, '');
                    [result] = await connection.execute(`
              UPDATE eodhd_exchange_symbols 
              SET dividend_frequency = ? 
              WHERE symbol = ? AND exchange = 'US'
            `, [frequency, shortSymbol]);
                }

                if (result.affectedRows > 0) {
                    updatedCount++;
                    if (updatedCount % 100 === 0) {
                        console.log(`Updated ${updatedCount} symbols...`);
                    }
                }
            }
        }

        console.log(`Done! Updated frequency for ${updatedCount} symbols.`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await connection.end();
    }
}

main();
