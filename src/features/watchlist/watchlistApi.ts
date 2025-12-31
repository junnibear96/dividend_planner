type WatchlistItem = {
  id: string
  symbol: string
  createdAt: string
  name: string | null
  type: string | null
  currency: string | null
  price: number | null
  change: number | null
  changePercent: number | null
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
    body && typeof body === 'object' && 'error' in body && typeof (body as any).error === 'string'
      ? String((body as any).error)
      : `Request failed (${res.status})`
  throw new Error(message)
}

export async function listWatchlist(): Promise<WatchlistItem[]> {
  const res = await fetch('/api/watchlist')
  const body = (await jsonOrError(res)) as { items?: unknown }
  return Array.isArray(body.items) ? (body.items as WatchlistItem[]) : []
}

export async function addToWatchlist(symbol: string): Promise<void> {
  const res = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  })
  await jsonOrError(res)
}

export async function removeFromWatchlist(symbol: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
  if (res.status === 204) return
  await jsonOrError(res)
}

export async function refreshWatchlist(): Promise<void> {
  const res = await fetch('/api/watchlist/refresh', { method: 'POST' })
  await jsonOrError(res)
}

export async function searchWatchlistSymbols(
  query: string,
  limit = 10,
  exchange = 'US',
  signal?: AbortSignal,
): Promise<string[]> {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const url = `/api/watchlist/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(
    String(limit),
  )}&exchange=${encodeURIComponent(exchange)}`
  const res = await fetch(url, { signal })
  const body = (await jsonOrError(res)) as { symbols?: unknown }
  const arr = Array.isArray(body.symbols) ? body.symbols : []
  return arr.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean)
}

export type { WatchlistItem }
