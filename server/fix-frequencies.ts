
import './env'
import mysql from 'mysql2/promise'

function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`Missing required env var: ${name}`)
    }
    return value
}

const pool = mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? '3306'),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: requireEnv('DB_DATABASE'),
    connectionLimit: 1, // Script only needs one connection
    namedPlaceholders: true,
    decimalNumbers: true,
})

async function main() {
    console.log('Starting dividend frequency fix...')

    try {
        // 1. Get all symbols that have dividend data
        const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT DISTINCT symbol FROM stock_dividends')
        const symbols = rows.map((r: any) => r.symbol)
        console.log(`Found ${symbols.length} symbols with dividend data.`)

        let updatedCount = 0

        for (const symbol of symbols) {
            // 2. Fetch dividends for each symbol
            const [divRows] = await pool.query<mysql.RowDataPacket[]>(
                'SELECT date FROM stock_dividends WHERE symbol = ? ORDER BY date DESC',
                [symbol]
            )

            const dividends = divRows as { date: string | Date }[]
            if (dividends.length === 0) continue

            const now = new Date()
            // Logic for frequency
            // 1. Weekly check (last 90 days >= 10 OR last year >= 40)
            const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
            const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

            const recent90 = dividends.filter(d => new Date(d.date) >= threeMonthsAgo)
            const recent365 = dividends.filter(d => new Date(d.date) >= oneYearAgo)

            let frequency = 'Annually' // Default lowest

            if (recent90.length >= 10) {
                frequency = 'Weekly'
            } else if (recent365.length >= 40) {
                frequency = 'Weekly'
            } else if (recent365.length >= 10) {
                frequency = 'Monthly'
            } else if (recent365.length >= 3) {
                frequency = 'Quarterly'
            } else if (recent365.length >= 1) {
                frequency = 'Annually'
            } else {
                // No dividends in last year, check history? defaulting to Annually or Null? 
                // If they have dividends but none recent, keep old value? 
                // For now, let's assume if they have data but not recent, maybe it's sporadic/Annually.
                // Let's stick safe and not overwrite if no recent data found (or set to Annually).
                // Actually, let's output a log if we can't determine.
                // console.log(`Symbol ${symbol}: No recent dividends (Last: ${dividends[0].date}). Skipping update?`)
                // Better to set to 'Unknown' or leave as is.
                // Let's only update if we found a match.
                continue;
            }

            // 3. Update DB
            // We only update if it's different? Or just force update. 
            // Force update is safer to ensure consistency.
            await pool.query(
                'UPDATE eodhd_exchange_symbols SET dividend_frequency = ? WHERE symbol = ?',
                [frequency, symbol]
            )
            // console.log(`Updated ${symbol} -> ${frequency}`)
            updatedCount++
        }

        console.log(`Finished! Updated frequencies for ${updatedCount} symbols.`)

    } catch (err) {
        console.error('Error running fix script:', err)
    } finally {
        await pool.end()
    }
}

main()
