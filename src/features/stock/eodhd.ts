// Shared types/utilities for EODHD-shaped data.
// Stock fetching/caching is now done via the backend (see `src/features/stock/stockApi.ts`).

export type EodhdRealTimeResponse = {
  code?: string
  symbol?: string
  name?: string
  exchange?: string

  // Common price fields (per docs; some may be absent depending on plan)
  close?: number
  price?: number
  last?: number

  previousClose?: number
  previous_close?: number

  change?: number
  change_p?: number
  changePercent?: number

  high?: number
  low?: number
  open?: number
  volume?: number

  // some responses include `timestamp` or `date`
  timestamp?: number
  date?: string
}

export type EodhdEodBar = {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  adjusted_close?: number
  volume?: number
}

export type EodhdDividendRow = {
  date: string // YYYY-MM-DD
  value: number
  currency?: string
  period?: string
  declarationDate?: string
  recordDate?: string
  paymentDate?: string
}

export function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseYyyyMmDd(date: string): Date | null {
  // Treat as UTC midnight to avoid TZ shifting dates.
  const m = /^\d{4}-\d{2}-\d{2}$/.test(date)
  if (!m) return null
  const d = new Date(`${date}T00:00:00.000Z`)
  return Number.isFinite(d.valueOf()) ? d : null
}
