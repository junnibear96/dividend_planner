import _YahooFinance from 'yahoo-finance2'
const yahooFinance = new _YahooFinance()

// -----------------------------------------------------------------------------
// [Yahoo Finance Unofficial API Module]
// 
// Note: This module uses an unofficial API. Stability is not guaranteed.
// Rate limits and IP bans are possible if abused.
// -----------------------------------------------------------------------------

const log = (msg: string) => console.log(`[YahooFinance] ${msg}`)
const errorLog = (msg: string, err: unknown) => console.error(`[YahooFinance] ${msg}`, err instanceof Error ? err.message : String(err))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export type YahooStockData = {
    symbol: string
    price: number
    change: number
    changePercent: number
    previousClose: number
    name: string
    currency: string
    exchange: string
    dividendRate: number
    dividendYield: number
    source: 'yahoo'
    fetchedAt: string
    low52: number
    high52: number
}

export async function fetchStockDataYahoo(symbol: string, retries = 3): Promise<YahooStockData | null> {
    // EODHD uses 'JPMO.US', Yahoo prefers 'JPMO' for US stocks.
    // Logic: Remove '.US' suffix. Keep others like '.KS', '.T'.
    const ySymbol = symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol

    let attempt = 0
    while (attempt < retries) {
        try {
            log(`Fetching quoteSummary for ${ySymbol} (Attempt ${attempt + 1})`)

            const result = await yahooFinance.quoteSummary(ySymbol, {
                modules: ['price', 'summaryDetail']
            }) as any

            if (!result || !result.price) throw new Error('Empty response')

            const priceObj = result.price
            const summary = result.summaryDetail || {}

            const price = priceObj.regularMarketPrice ?? 0
            const previousClose = priceObj.regularMarketPreviousClose ?? price

            // Dividend fallbacks (summaryDetail has better dividend info than quote)
            const dividendRate = summary.dividendRate ?? summary.trailingAnnualDividendRate ?? 0
            const dividendYield = (summary.dividendYield ?? summary.trailingAnnualDividendYield ?? 0) * 100

            return {
                symbol: symbol,
                price,
                change: priceObj.regularMarketChange ?? 0,
                changePercent: (priceObj.regularMarketChangePercent ?? 0) * 100, // quoteSummary percent is usually 0.01 for 1%
                previousClose,
                name: priceObj.shortName ?? priceObj.longName ?? symbol,
                currency: priceObj.currency ?? 'USD',
                exchange: priceObj.exchangeName ?? priceObj.exchange ?? 'Unknown',

                // Dividends
                dividendRate,
                dividendYield,

                source: 'yahoo',
                fetchedAt: new Date().toISOString(),
                low52: summary.fiftyTwoWeekLow ?? 0,
                high52: summary.fiftyTwoWeekHigh ?? 0
            }
        } catch (err) {
            attempt++
            errorLog(`Error fetching ${ySymbol}`, err)
            if (attempt >= retries) break
            await sleep(1000 * Math.pow(2, attempt)) // Exponential backoff: 2s, 4s...
        }
    }

    log(`Failed to fetch ${symbol} after ${retries} attempts.`)
    return null
}

export async function fetchStockDataBatchYahoo(symbols: string[]): Promise<Record<string, YahooStockData>> {
    if (symbols.length === 0) return {}

    const symbolMap = new Map<string, string>()
    const ySymbols = symbols.map(s => {
        const y = s.endsWith('.US') ? s.slice(0, -3) : s
        symbolMap.set(y, s)
        return y
    })

    const uniqueYSymbols = Array.from(new Set(ySymbols))

    try {
        log(`Fetching batch quotes for ${uniqueYSymbols.length} symbols`)
        const quotes = await yahooFinance.quote(uniqueYSymbols) as unknown as any[]

        const results: Record<string, YahooStockData> = {}
        const list = Array.isArray(quotes) ? quotes : [quotes]

        for (const quote of list) {
            if (!quote || !quote.symbol) continue
            const ySym = quote.symbol
            const originalSym = symbolMap.get(ySym) || ySym

            const price = quote.regularMarketPrice ?? 0
            const previousClose = quote.regularMarketPreviousClose ?? price

            results[originalSym] = {
                symbol: originalSym,
                price,
                change: quote.regularMarketChange ?? 0,
                changePercent: quote.regularMarketChangePercent ?? 0,
                previousClose,
                name: quote.shortName ?? quote.longName ?? originalSym,
                currency: quote.currency ?? 'USD',
                exchange: quote.exchange ?? 'Unknown',
                dividendRate: quote.trailingAnnualDividendRate ?? 0,
                dividendYield: (quote.trailingAnnualDividendYield ?? 0) * 100,
                source: 'yahoo',
                fetchedAt: new Date().toISOString(),
                low52: quote.fiftyTwoWeekLow ?? 0,
                high52: quote.fiftyTwoWeekHigh ?? 0
            }
        }
        return results
    } catch (err) {
        errorLog('Batch fetch failed', err)
        return {}
    }
}

export async function fetchStockEodYahoo(symbol: string, from: string, to: string): Promise<any[]> {
    const ySymbol = symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol
    try {
        log(`Fetching EOD for ${ySymbol} (${from} to ${to})`)
        const result = await yahooFinance.historical(ySymbol, {
            period1: from,
            period2: to,
            interval: '1d'
        }) as any[]
        return result.map(q => ({
            date: q.date.toISOString().split('T')[0],
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            adjusted_close: q.adjClose,
            volume: q.volume
        }))
    } catch (e) {
        errorLog(`EOD fetch failed for ${symbol}`, e)
        return []
    }
}

export async function fetchStockDividendsYahoo(symbol: string): Promise<any[]> {
    const ySymbol = symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol
    const period1 = '2000-01-01'

    try {
        log(`Fetching Dividends for ${ySymbol}`)
        const result = await yahooFinance.historical(ySymbol, {
            period1: period1,
            interval: '1d',
            events: 'dividends'
        }) as any[]

        return result.map(q => ({
            date: q.date.toISOString().split('T')[0],
            value: q.dividends,
            currency: null
        }))
    } catch (e) {
        errorLog(`Dividends fetch failed for ${symbol}`, e)
        return []
    }
}
