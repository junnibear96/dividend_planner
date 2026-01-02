export type SymbolListItem = {
  symbol: string
  name: string | null
  type: string | null
  currency: string | null
}

export type SymbolsListResponse = {
  exchange: string
  q: string
  limit: number
  offset: number
  total: number
  hasMore: boolean
  items: SymbolListItem[]
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

export async function listSymbols(args: {
  exchange?: string
  q?: string
  limit?: number
  offset?: number
  signal?: AbortSignal
}): Promise<SymbolsListResponse> {
  const exchange = (args.exchange ?? 'US').trim().toUpperCase() || 'US'
  const q = String(args.q ?? '').trim()
  const limit = typeof args.limit === 'number' ? args.limit : 100
  const offset = typeof args.offset === 'number' ? args.offset : 0

  const url = `/api/symbols?exchange=${encodeURIComponent(exchange)}&q=${encodeURIComponent(
    q,
  )}&limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`

  const res = await fetch(url, { signal: args.signal })
  return (await jsonOrError(res)) as SymbolsListResponse
}
