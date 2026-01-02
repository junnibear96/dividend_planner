export type StockApiEodRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export type StockApiDividendRow = {
  date: string
  value: number
  currency: string | null
}

export type StockApiResponse = {
  symbol: string
  source: {
    realtime: 'db' | 'api'
    eod: 'db' | 'api'
    dividends: 'db' | 'api'
  }
  realtime: unknown
  eod: StockApiEodRow[]
  dividends: StockApiDividendRow[]
}

async function jsonOrError(res: Response) {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (res.ok) return body
  const message =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${res.status})`
  throw new Error(message)
}

export async function getStockCached(symbol: string, limit = 30): Promise<StockApiResponse> {
  const url = `/api/stocks/${encodeURIComponent(symbol)}?limit=${encodeURIComponent(String(limit))}`
  const res = await fetch(url)
  return (await jsonOrError(res)) as StockApiResponse
}

export async function searchStockSymbols(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<string[]> {
  const q = query.trim().toUpperCase()
  if (!q) return []

  const normalize = (arr: unknown[]) =>
    arr.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean)

  // Prefer the full EODHD exchange symbol cache (public endpoint).
  try {
    const url = `/api/symbols/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(
      String(limit),
    )}`
    const res = await fetch(url, { signal })
    const body = (await jsonOrError(res)) as { symbols?: unknown }
    const arr = Array.isArray(body.symbols) ? body.symbols : []
    return normalize(arr)
  } catch {
    // Fallback: local cached symbols only.
    const url = `/api/stocks/symbols?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(
      String(limit),
    )}`
    const res = await fetch(url, { signal })
    const body = (await jsonOrError(res)) as { symbols?: unknown }
    const arr = Array.isArray(body.symbols) ? body.symbols : []
    return normalize(arr)
  }
}
