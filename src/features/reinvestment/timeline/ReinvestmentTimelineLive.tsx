import { useEffect, useMemo, useState } from 'react'
import type { PlannerHolding } from '../../planner/DividendPlanner'
import { fetchReinvestmentHistory, fetchReinvestmentSummary, type ReinvestmentExecution, type ReinvestmentRule } from '../reinvestmentApi'
import ReinvestmentTimeline from './ReinvestmentTimeline'
import { makeUtcDate, type MonthNumber } from './dateUtils'
import type { GenerateWeeklyReinvestmentTimeline, Holdings, ReinvestmentExecutionWeek, TimelineShares } from './types'

async function jsonOrNull(res: Response) {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

async function fetchHoldings(): Promise<PlannerHolding[]> {
  const res = await fetch('/api/holdings')
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to load holdings (${res.status})`)
  }
  const data = (await res.json()) as { holdings?: PlannerHolding[] }
  return Array.isArray(data.holdings) ? data.holdings : []
}

function normalizeMonth(m: number): MonthNumber {
  const mm = Math.max(1, Math.min(12, Math.floor(m)))
  return mm as MonthNumber
}

function monthYearFromDateUtc(d: Date): { year: number; month: MonthNumber } {
  return { year: d.getUTCFullYear(), month: normalizeMonth(d.getUTCMonth() + 1) }
}

function sharesBySymbolFromHoldings(holdings: PlannerHolding[]): TimelineShares {
  const out: TimelineShares = {}
  for (const h of holdings) {
    const sym = String(h.symbol ?? '').trim().toUpperCase()
    if (!sym) continue
    if (h.includeInReinvestment === false) continue
    const s = Number(h.shares)
    if (!Number.isFinite(s) || s <= 0) continue
    out[sym] = (out[sym] ?? 0) + s
  }
  return out
}

function buildExecutionWeeks(executions: ReinvestmentExecution[]): ReinvestmentExecutionWeek[] {
  return executions
    .map((e) => {
      const sharesAdded: TimelineShares = {}
      const details = Array.isArray(e.executionDetails?.details) ? e.executionDetails.details : []
      for (const d of details) {
        const sym = String(d.symbol ?? '').trim().toUpperCase()
        if (!sym) continue
        const sh = Number(d.sharesBought)
        if (!Number.isFinite(sh) || sh <= 0) continue
        sharesAdded[sym] = (sharesAdded[sym] ?? 0) + sh
      }
      return {
        executedAt: e.executedAt,
        reinvestedAmount: Number(e.totalAmount) || 0,
        dividendEarned: Number(e.totalAmount) || 0,
        sharesAdded,
      } satisfies ReinvestmentExecutionWeek
    })
    .filter((e) => Number.isFinite(new Date(e.executedAt).getTime()))
}

function clampNonNegativeShares(shares: TimelineShares): TimelineShares {
  const out: TimelineShares = {}
  for (const [sym, v] of Object.entries(shares)) {
    const n = Number(v)
    out[sym] = Number.isFinite(n) ? Math.max(0, n) : 0
  }
  return out
}

function subtractShares(base: TimelineShares, delta: TimelineShares): TimelineShares {
  const out: TimelineShares = { ...base }
  for (const [sym, dv] of Object.entries(delta)) {
    const d = Number(dv)
    if (!Number.isFinite(d) || d <= 0) continue
    out[sym] = Math.max(0, Number(out[sym] ?? 0) - d)
  }
  return out
}

function buildPriceBySymbolFromHistory(executions: ReinvestmentExecution[]): Record<string, number> {
  // Use the latest observed execution price per symbol; fallback later if missing.
  const latest: Record<string, { t: number; price: number }> = {}
  for (const e of executions) {
    const t = new Date(e.executedAt).getTime()
    if (!Number.isFinite(t)) continue
    const details = Array.isArray(e.executionDetails?.details) ? e.executionDetails.details : []
    for (const d of details) {
      const sym = String(d.symbol ?? '').trim().toUpperCase()
      if (!sym) continue
      const price = Number(d.price)
      if (!Number.isFinite(price) || price <= 0) continue
      const cur = latest[sym]
      if (!cur || t > cur.t) latest[sym] = { t, price }
    }
  }
  const out: Record<string, number> = {}
  for (const [sym, v] of Object.entries(latest)) out[sym] = v.price
  return out
}

function normalizeWeights(assets: Array<{ symbol: string; weight?: number }>): Array<{ symbol: string; weight: number }> {
  const cleaned: Array<{ symbol: string; weight: number }> = []
  for (const a of assets) {
    const sym = String(a.symbol ?? '').trim().toUpperCase()
    if (!sym) continue
    const w = Number(a.weight ?? 0)
    if (!Number.isFinite(w) || w <= 0) continue
    cleaned.push({ symbol: sym, weight: w })
  }
  const total = cleaned.reduce((s, a) => s + a.weight, 0)
  if (total <= 0) return []
  return cleaned.map((a) => ({ symbol: a.symbol, weight: a.weight / total }))
}

function effectiveDestination(rule: ReinvestmentRule, weekIndex: number) {
  if (rule.scheduleMode !== 'WEEK_OF_MONTH') {
    return { destinationType: rule.destinationType, destinationAssets: rule.destinationAssets }
  }
  const w = (weekIndex === 5 ? 4 : weekIndex) as 1 | 2 | 3 | 4
  const d = rule.weekDestinations?.[w]
  return d ?? { destinationType: rule.destinationType, destinationAssets: rule.destinationAssets }
}

function weeklyEquivalentDividendPerShare(h: PlannerHolding): number {
  const dps = Number(h.dividendPerShare)
  if (!Number.isFinite(dps) || dps < 0) return 0
  if (h.dividendFrequency === 'weekly') return dps
  if (h.dividendFrequency === 'monthly') return dps / 4
  return dps / 52
}

export default function ReinvestmentTimelineLive() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [holdingsRows, setHoldingsRows] = useState<PlannerHolding[]>([])
  const [rule, setRule] = useState<ReinvestmentRule | null>(null)
  const [history, setHistory] = useState<ReinvestmentExecution[]>([])

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    setError(null)
    Promise.all([fetchHoldings(), fetchReinvestmentSummary(), fetchReinvestmentHistory(200)])
      .then(([h, s, hist]) => {
        if (!alive) return
        setHoldingsRows(h)
        setRule(s.rule)
        setHistory(Array.isArray(hist.executions) ? hist.executions : [])
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load timeline data')
      })
      .finally(() => {
        if (!alive) return
        setIsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const now = new Date()
  const initialMY = monthYearFromDateUtc(now)

  const { year: compoundingStartYear, month: compoundingStartMonth } = useMemo(() => {
    // Anchor compounding to earliest observed execution month; fallback to current month.
    let earliest: Date | null = null
    for (const e of history) {
      const d = new Date(e.executedAt)
      if (!Number.isFinite(d.getTime())) continue
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d
    }
    return earliest ? monthYearFromDateUtc(earliest) : initialMY
  }, [history, initialMY])

  const baselineHoldings: Holdings = useMemo(() => {
    // Best-effort baseline: current holdings minus all shares bought since compounding start.
    // (Assumes reinvestments are the primary driver of share increases.)
    const current = sharesBySymbolFromHoldings(holdingsRows)

    const startDate = makeUtcDate(compoundingStartYear, compoundingStartMonth, 1)

    // Subtract executions that occur on/after the compounding start month.
    let baseline = { ...current }
    for (const e of buildExecutionWeeks(history)) {
      const t = new Date(e.executedAt)
      if (!Number.isFinite(t.getTime())) continue
      // If the execution is within or after the start month, subtract.
      if (t.getTime() >= startDate.getTime()) {
        baseline = subtractShares(baseline, e.sharesAdded)
      }
    }

    // Clamp for safety.
    baseline = clampNonNegativeShares(baseline)

    return { sharesBySymbol: baseline }
  }, [holdingsRows, history, compoundingStartYear, compoundingStartMonth])

  const executionWeeks = useMemo(() => buildExecutionWeeks(history), [history])

  const generator: GenerateWeeklyReinvestmentTimeline | undefined = useMemo(() => {
    if (!rule) return undefined

    const priceBySymbol = buildPriceBySymbolFromHistory(history)
    const holdingsBySymbol: Record<string, PlannerHolding> = {}
    for (const h of holdingsRows) {
      const sym = String(h.symbol ?? '').trim().toUpperCase()
      if (!sym) continue
      holdingsBySymbol[sym] = h
    }

    return ({ startDate, weekIndex, startingShares }) => {
      // Determine eligible symbols based on rule scope.
      const eligibleSymbols = Object.keys(startingShares).filter((sym) => {
        const h = holdingsBySymbol[sym]
        if (!h) return false
        if (rule.sourceScope === 'SELECTED') return h.includeInReinvestment !== false
        return true
      })

      // Deterministic dividend accrual per slice:
      // - weekly: every week
      // - monthly: week 1
      // - yearly: January week 1
      let dividendEarned = 0
      const dividendBySymbol: Record<string, number> = {}
      for (const sym of eligibleSymbols) {
        const h = holdingsBySymbol[sym]
        if (!h) continue
        const shares = Number(startingShares[sym] ?? 0)
        if (!Number.isFinite(shares) || shares <= 0) continue

        const dps = Number(h.dividendPerShare)
        if (!Number.isFinite(dps) || dps <= 0) continue

        let occurrences = 0
        if (h.dividendFrequency === 'weekly') occurrences = 1
        else if (h.dividendFrequency === 'monthly') occurrences = weekIndex === 1 ? 1 : 0
        else occurrences = startDate.getUTCMonth() === 0 && weekIndex === 1 ? 1 : 0

        const amt = shares * dps * occurrences
        if (amt > 0) {
          dividendEarned += amt
          dividendBySymbol[sym] = (dividendBySymbol[sym] ?? 0) + amt
        }
      }

      // Apply minimum threshold.
      if (!Number.isFinite(dividendEarned) || dividendEarned < Number(rule.minimumAmount ?? 0)) {
        return {
          dividendEarned: Math.max(0, Number.isFinite(dividendEarned) ? dividendEarned : 0),
          reinvestedAmount: 0,
          sharesAdded: {},
          endingShares: { ...startingShares },
          nextWeekDividendEstimate: 0,
        }
      }

      const reinvestedAmount = dividendEarned
      const dest = effectiveDestination(rule, weekIndex)

      let weights: Array<{ symbol: string; weight: number }> = []
      if (dest.destinationType === 'SAME_AS_SOURCE') {
        const total = Object.values(dividendBySymbol).reduce((s, v) => s + (Number(v) || 0), 0)
        if (total > 0) {
          weights = Object.entries(dividendBySymbol)
            .filter(([, v]) => Number(v) > 0)
            .map(([sym, v]) => ({ symbol: sym, weight: Number(v) / total }))
        }
      } else if (dest.destinationType === 'SINGLE_ASSET') {
        const sym = String(dest.destinationAssets?.[0]?.symbol ?? '').trim().toUpperCase()
        if (sym) weights = [{ symbol: sym, weight: 1 }]
      } else {
        weights = normalizeWeights(dest.destinationAssets ?? [])
      }

      const sharesAdded: TimelineShares = {}
      for (const w of weights) {
        const dollars = reinvestedAmount * w.weight
        if (!Number.isFinite(dollars) || dollars <= 0) continue
        const price = Number(priceBySymbol[w.symbol] ?? 100)
        if (!Number.isFinite(price) || price <= 0) continue

        let bought = dollars / price
        if (!rule.fractionalSharesAllowed) bought = Math.floor(bought)
        if (!Number.isFinite(bought) || bought <= 0) continue
        sharesAdded[w.symbol] = (sharesAdded[w.symbol] ?? 0) + bought
      }

      const endingShares: TimelineShares = { ...startingShares }
      for (const [sym, inc] of Object.entries(sharesAdded)) {
        endingShares[sym] = Number(endingShares[sym] ?? 0) + Number(inc ?? 0)
      }

      // Next-week dividend estimate indicator (weekly-equivalent impact of added shares).
      let nextWeekDividendEstimate = 0
      for (const [sym, inc] of Object.entries(sharesAdded)) {
        const h = holdingsBySymbol[sym]
        if (!h) continue
        const perWeek = weeklyEquivalentDividendPerShare(h)
        const add = Number(inc)
        if (!Number.isFinite(add) || add <= 0) continue
        nextWeekDividendEstimate += add * perWeek
      }

      return {
        dividendEarned,
        reinvestedAmount,
        sharesAdded,
        endingShares,
        nextWeekDividendEstimate,
      }
    }
  }, [rule, history, holdingsRows])

  if (isLoading) {
    return (
      <section className="panel" aria-label="Dividend reinvestment timeline">
        <h2>Dividend Reinvestment Timeline</h2>
        <p className="empty">Loading…</p>
      </section>
    )
  }

  if (error || !rule) {
    return (
      <section className="panel" aria-label="Dividend reinvestment timeline">
        <h2>Dividend Reinvestment Timeline</h2>
        <p className="error" role="alert" aria-live="polite">
          {error ?? 'Missing reinvestment rule'}
        </p>
      </section>
    )
  }

  return (
    <ReinvestmentTimeline
      initialMonth={initialMY.month}
      initialYear={initialMY.year}
      compoundingStartMonth={compoundingStartMonth}
      compoundingStartYear={compoundingStartYear}
      holdings={baselineHoldings}
      reinvestmentRules={rule}
      reinvestmentExecutions={executionWeeks}
      generateWeeklyReinvestmentTimeline={generator}
    />
  )
}
