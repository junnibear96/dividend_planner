import mysql from 'mysql2/promise'
import { fetchStockDataBatchYahoo } from './yahoo'


// EODHD helpers removed


async function updateRealTimeData(pool: mysql.Pool) {
    console.log('[Scheduler] Starting 6-hour real-time data update...')
    const start = Date.now()

    try {
        // 1. Get all symbols from eodhd_exchange_symbols
        // Join with stock_realtime to check fetched_at. Also include symbols not in stock_realtime yet.
        const [rows] = await pool.query<mysql.RowDataPacket[]>(`
            SELECT s.symbol 
            FROM eodhd_exchange_symbols s
            LEFT JOIN stock_realtime r ON s.symbol = r.symbol
            WHERE r.fetched_at IS NULL 
               OR r.fetched_at < DATE_SUB(NOW(), INTERVAL 12 HOUR)
        `)
        const allSymbols = (rows as unknown as { symbol: string }[]).map(r => r.symbol).filter(Boolean)

        if (allSymbols.length === 0) {
            console.log('[Scheduler] No stale symbols found to update (checked > 12h).')
            return
        }

        console.log(`[Scheduler] Found ${allSymbols.length} stale symbols to update (> 12h old).`)

        // 2. Chunk and fetch
        // User requested limit: ~900 symbols per minute.
        // Chunk size = 50.
        // Chunks per minute = 900 / 50 = 18.
        // Seconds per chunk = 60 / 18 = 3.333s.
        // We'll wait 3400ms between chunks to be safe.
        const CHUNK_SIZE = 50
        const DELAY_MS = 3400
        let updatedCount = 0

        for (let i = 0; i < allSymbols.length; i += CHUNK_SIZE) {
            const chunk = allSymbols.slice(i, i + CHUNK_SIZE)
            try {
                // Yahoo Batch
                const batchMap = await fetchStockDataBatchYahoo(chunk)
                const items = Object.values(batchMap)

                // 3. Upsert
                for (const item of items) {
                    const code = item.symbol
                    if (!code) continue

                    await pool.execute(
                        `INSERT INTO stock_realtime (symbol, payload, fetched_at)
              VALUES (:symbol, :payload, CURRENT_TIMESTAMP)
              ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
                        { symbol: code, payload: JSON.stringify(item) }
                    )
                    updatedCount++
                }

                // Rate limit delay (Wait between chunks to avoid Yahoo ban if aggressive)
                await new Promise(r => setTimeout(r, DELAY_MS))

            } catch (err: unknown) {
                console.error(`[Scheduler] Error fetching chunk ${i}-${i + CHUNK_SIZE}:`, err)
            }
        }

        const duration = ((Date.now() - start) / 1000).toFixed(1)
        console.log(`[Scheduler] Update complete. Updated ${updatedCount} symbols in ${duration}s.`)

    } catch (err) {
        console.error('[Scheduler] Fatal error:', err)
    }
}

export function startScheduler(pool: mysql.Pool) {
    // Run immediately on start? Or wait? 
    // Probably verify if data is stale first, but user asked for "scheduler is every 6 hours".
    // Let's run it once on start (async) then schedule.

    void updateRealTimeData(pool)

    const INTERVAL_MS = 12 * 60 * 60 * 1000
    setInterval(() => {
        void updateRealTimeData(pool)
    }, INTERVAL_MS)

    console.log(`[Scheduler] Initialized (interval: 12h)`)
}
