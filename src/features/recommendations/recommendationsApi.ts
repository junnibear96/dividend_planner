export type RecommendedStock = {
  symbol: string
  exchange: string
  name: string
  type: 'STOCK' | 'ETF'
  price: number
  score: number
  reason: string
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

export async function listRecommendations(): Promise<RecommendedStock[]> {
  const res = await fetch('/api/recommendations')
  const body = (await jsonOrError(res)) as { items?: unknown }
  return Array.isArray(body.items) ? (body.items as RecommendedStock[]) : []
}
