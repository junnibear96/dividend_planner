import mysql from 'mysql2/promise'


function redactEodhdUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl)
        if (u.searchParams.has('api_token')) {
            u.searchParams.set('api_token', 'REDACTED')
        }
        return u.toString()
    } catch {
        return rawUrl.replace(/api_token=([^&]+)/i, 'api_token=REDACTED')
    }
}

async function eodhdFetchJson(url: string): Promise<unknown> {
    const res = await fetch(url)
    if (!res.ok) {
        throw new Error(`EODHD request failed (${res.status}) for ${redactEodhdUrl(url)}`)
    }
    return (await res.json()) as unknown
}

async function fetchBulkRealTime(symbols: string[]): Promise<unknown[]> {
    const token = process.env.EODHD_API_TOKEN
    if (!token) throw new Error('Missing EODHD_API_TOKEN')
    if (symbols.length === 0) return []

    // EODHD Real-time bulk: /real-time/FirstSymbol?s=SecondSymbol,ThirdSymbol,...&fmt=json
    const first = symbols[0]
    const rest = symbols.slice(1)
    const sParam = rest.length > 0 ? `&s=${rest.map(encodeURIComponent).join(',')}` : ''

    const url = `https://eodhd.com/api/real-time/${encodeURIComponent(first)}?api_token=${encodeURIComponent(token)}&fmt=json${sParam}`

    const res = await eodhdFetchJson(url)
    // Determine if response is array or single object
    if (Array.isArray(res)) return res
    // If single object, wrap in array (unless it's empty/error?)
    if (res && typeof res === 'object') return [res]
    return []
}

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
                const data = await fetchBulkRealTime(chunk) as any[]

                // 3. Upsert
                for (const item of data) {
                    const code = item.code || item.symbol
                    if (!code) continue

                    await pool.execute(
                        `INSERT INTO stock_realtime (symbol, payload, fetched_at)
              VALUES (:symbol, :payload, CURRENT_TIMESTAMP)
              ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
                        { symbol: code, payload: JSON.stringify(item) }
                    )
                    updatedCount++
                }

                // Rate limit delay
                await new Promise(r => setTimeout(r, DELAY_MS))

            } catch (err: unknown) {
                // Handle 402 specifically
                const msg = err instanceof Error ? err.message : String(err)
                if (msg.includes('402')) {
                    console.log(`[Scheduler] API Limit Reached (402). Pausing real-time updates for this cycle.`)
                    break // Stop processing this cycle gracefully
                } else {
                    console.error(`[Scheduler] Error fetching chunk ${i}-${i + CHUNK_SIZE}:`, err)
                }
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
