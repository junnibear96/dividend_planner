import { getCache, setCache } from './redis'

/**
 * Cache TTL policies (in seconds)
 */
export const CacheTTL = {
    REALTIME: 60, // 1 minute - real-time stock prices
    EOD: 86400, // 24 hours - end of day historical data
    FUNDAMENTALS: 604800, // 7 days - company fundamentals
    DIVIDENDS: 604800, // 7 days - dividend information
    SYMBOLS: 2592000, // 30 days - exchange symbol listings
    USER_DATA: 300, // 5 minutes - user portfolio/holdings
    STOCK_ENDPOINT: 30, // 30 seconds - full stock page API response (ultra-fast)
    EOD_CHART_ENDPOINT: 60, // 1 minute - EOD chart data endpoint
    PORTFOLIO_ENDPOINT: 15, // 15 seconds - portfolio positions list (ultra-fast)
    PORTFOLIO_CASH_ENDPOINT: 15, // 15 seconds - cash balance (ultra-fast)
    WATCHLIST_ENDPOINT: 60, // 1 minute - watchlist endpoint
} as const

/**
 * Generate consistent cache keys
 */
export const CacheKeys = {
    // EODHD API endpoints
    eodhdRealtime: (symbol: string) => `eodhd:realtime:${symbol}`,
    eodhdEod: (symbol: string, limit: number) => `eodhd:eod:${symbol}:${limit}`,
    eodhdEodRange: (symbol: string, from: string, to: string) => `eodhd:eod:range:${symbol}:${from}:${to}`,
    eodhdDividends: (symbol: string) => `eodhd:div:${symbol}`,
    eodhdFundamentals: (symbol: string) => `eodhd:fundamentals:${symbol}`,
    eodhdExchangeSymbols: (exchange: string) => `eodhd:symbols:${exchange}`,

    // User data
    userPortfolio: (userId: string) => `user:portfolio:${userId}`,
    userHoldings: (userId: string) => `user:holdings:${userId}`,
    userWatchlist: (userId: string) => `user:watchlist:${userId}`,

    // API endpoint responses (full page data) - for ultra-fast page loads
    stockEndpoint: (symbol: string, limit: number) => `api:stock:${symbol}:${limit}`,
    eodChartEndpoint: (symbol: string, from: string, to: string) => `api:eod:${symbol}:${from}:${to}`,
    portfolioEndpoint: (userId: string) => `api:portfolio:${userId}`,
    portfolioCashEndpoint: (userId: string) => `api:portfolio:cash:${userId}`,
    watchlistEndpoint: (userId: string) => `api:watchlist:${userId}`,
} as const

/**
 * Generic cache wrapper function (cache-aside pattern)
 * 
 * @param cacheKey Redis cache key
 * @param ttlSeconds Time to live in seconds
 * @param fetchFn Function to fetch data if cache miss
 * @returns Cached data or fresh data from fetchFn
 */
export async function withCache<T>(
    cacheKey: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
): Promise<T> {
    // Try to get from cache first
    const cached = await getCache<T>(cacheKey)
    if (cached !== null) {
        console.log(`✅ Cache HIT: ${cacheKey}`)
        return cached
    }

    // Cache miss - fetch fresh data
    console.log(`⚠️  Cache MISS: ${cacheKey}`)
    const freshData = await fetchFn()

    // Store in cache for next time (Skip if empty as per user request)
    const isEmpty =
        freshData === null ||
        freshData === undefined ||
        (Array.isArray(freshData) && freshData.length === 0)

    if (!isEmpty) {
        await setCache(cacheKey, freshData, ttlSeconds)
    } else {
        console.log(`🚫 Skipping cache set for empty value: ${cacheKey}`)
    }

    return freshData
}

/**
 * Wrapper for caching with error handling
 * Falls back to direct function call if caching fails
 */
export async function withCacheSafe<T>(
    cacheKey: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
): Promise<T> {
    try {
        return await withCache(cacheKey, ttlSeconds, fetchFn)
    } catch (error) {
        console.error(`Cache wrapper error for key "${cacheKey}":`, error)
        // Fallback: call function directly without caching
        return await fetchFn()
    }
}
