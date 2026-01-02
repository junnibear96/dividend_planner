export type EodPoint = {
  date: string
  close: number
}

export type EodRangeResponse = {
  symbol: string
  from: string
  to: string
  source: 'db' | 'api'
  points: EodPoint[]
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

export async function getEodRange(symbol: string, from: string, to: string): Promise<EodRangeResponse> {
  const url = `/api/eod/${encodeURIComponent(symbol)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const res = await fetch(url)
  return (await jsonOrError(res)) as EodRangeResponse
}
