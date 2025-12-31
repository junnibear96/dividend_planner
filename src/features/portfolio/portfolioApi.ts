export type PortfolioPosition = {
  id: string
  symbol: string
  amount: number
  buyPrice: number | null
  createdAt: string
  updatedAt: string
}

type PortfolioListResponse = {
  positions?: unknown
}

type PortfolioPositionResponse = {
  position?: unknown
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

function asPosition(raw: unknown): PortfolioPosition | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  if (typeof r.id !== 'string') return null
  if (typeof r.symbol !== 'string') return null
  if (typeof r.amount !== 'number') return null
  if (!(r.buyPrice === null || typeof r.buyPrice === 'number')) return null
  if (typeof r.createdAt !== 'string') return null
  if (typeof r.updatedAt !== 'string') return null
  return {
    id: r.id,
    symbol: r.symbol,
    amount: r.amount,
    buyPrice: r.buyPrice,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export async function listPortfolio(): Promise<PortfolioPosition[]> {
  const res = await fetch('/api/portfolio')
  const body = (await jsonOrError(res)) as PortfolioListResponse
  const arr = Array.isArray(body.positions) ? body.positions : []
  return arr.map(asPosition).filter((v): v is PortfolioPosition => Boolean(v))
}

export async function createPortfolioPosition(input: {
  symbol: string
  amount: number
  buyPrice?: number | null
}): Promise<PortfolioPosition> {
  const res = await fetch('/api/portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await jsonOrError(res)) as PortfolioPositionResponse
  const pos = asPosition(body.position)
  if (!pos) throw new Error('Unexpected API response')
  return pos
}

export async function updatePortfolioPosition(
  id: string,
  patch: { amount?: number; buyPrice?: number | null },
): Promise<PortfolioPosition> {
  const res = await fetch(`/api/portfolio/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const body = (await jsonOrError(res)) as PortfolioPositionResponse
  const pos = asPosition(body.position)
  if (!pos) throw new Error('Unexpected API response')
  return pos
}
