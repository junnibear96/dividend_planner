import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlannerHolding } from '../../planner/DividendPlanner'
import {
  fetchReinvestmentHistory,
  fetchCollectionPlans,
  type ReinvestmentExecution,
  type CollectionPlan
} from '../reinvestmentApi'
import ReinvestmentTimeline from './ReinvestmentTimeline'
import { makeUtcDate, type MonthNumber } from './dateUtils'
import type { GenerateWeeklyReinvestmentTimeline, Holdings, ReinvestmentExecutionWeek, TimelineShares } from './types'

// --- Helpers ---

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

function weeklyEquivalentDividendPerShare(h: PlannerHolding): number {
  const dps = Number(h.dividendPerShare)
  if (!Number.isFinite(dps) || dps < 0) return 0
  if (h.dividendFrequency === 'weekly') return dps
  if (h.dividendFrequency === 'monthly') return dps / 4
  return dps / 52
}

// --- Component ---

export default function ReinvestmentTimelineLive() {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [holdingsRows, setHoldingsRows] = useState<PlannerHolding[]>([])
  const [history, setHistory] = useState<ReinvestmentExecution[]>([])
  const [plans, setPlans] = useState<CollectionPlan[]>([])

  useEffect(() => {
    let alive = true
    setIsLoading(true)
    setError(null)
    Promise.all([fetchHoldings(), fetchReinvestmentHistory(200), fetchCollectionPlans()])
      .then(([h, hist, p]) => {
        if (!alive) return
        setHoldingsRows(h)
        setHistory(Array.isArray(hist.executions) ? hist.executions : [])
        setPlans(p)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : t('timeline.errors.loadFailed'))
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
    let earliest: Date | null = null
    for (const e of history) {
      const d = new Date(e.executedAt)
      if (!Number.isFinite(d.getTime())) continue
      if (!earliest || d.getTime() < earliest.getTime()) earliest = d
    }
    return earliest ? monthYearFromDateUtc(earliest) : initialMY
  }, [history, initialMY])

  const baselineHoldings: Holdings = useMemo(() => {
    const current = sharesBySymbolFromHoldings(holdingsRows)
    const startDate = makeUtcDate(compoundingStartYear, compoundingStartMonth, 1)
    let baseline = { ...current }
    for (const e of buildExecutionWeeks(history)) {
      const t = new Date(e.executedAt)
      if (!Number.isFinite(t.getTime())) continue
      if (t.getTime() >= startDate.getTime()) {
        baseline = subtractShares(baseline, e.sharesAdded)
      }
    }
    baseline = clampNonNegativeShares(baseline)
    return { sharesBySymbol: baseline }
  }, [holdingsRows, history, compoundingStartYear, compoundingStartMonth])

  const executionWeeks = useMemo(() => buildExecutionWeeks(history), [history])

  const generator: GenerateWeeklyReinvestmentTimeline | undefined = useMemo(() => {
    const priceBySymbol = buildPriceBySymbolFromHistory(history)
    const holdingsBySymbol: Record<string, PlannerHolding> = {}
    for (const h of holdingsRows) {
      const sym = String(h.symbol ?? '').trim().toUpperCase()
      if (!sym) continue
      holdingsBySymbol[sym] = h
    }

    const activePlans = plans.filter(p => p.status === 'ACTIVE')

    return ({ startDate, weekIndex, startingShares }) => {

      // 1. Calculate Expected Dividends
      let dividendEarned = 0
      const dividendBySymbol: Record<string, number> = {}

      const allSymbols = new Set(Object.keys(startingShares))
      activePlans.forEach(p => allSymbols.add(p.targetStock))

      for (const sym of allSymbols) {
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

      // 2. Execute Plans (Simulate Buys)
      let reinvestedAmount = 0
      const sharesAdded: TimelineShares = {}

      for (const plan of activePlans) {
        let multiplier = 0
        if (plan.frequency === 'daily') multiplier = 5
        else if (plan.frequency === 'weekly') multiplier = 1
        else if (plan.frequency === 'monthly') multiplier = weekIndex === 1 ? 1 : 0

        if (multiplier > 0) {
          const price = priceBySymbol[plan.targetStock] || 100 // Fallback price
          if (price > 0) {
            let bought = 0
            let costUsd = 0

            if (plan.investmentType === 'QUANTITY') {
              // Buy fixed number of shares
              bought = plan.amount * multiplier
              costUsd = bought * price
            } else {
              // Buy fixed amount of currency
              let spendUsd = plan.amount * multiplier
              if (plan.currency === 'KRW') {
                spendUsd = spendUsd / 1450 // Approximate FX
              }

              bought = spendUsd / price
              costUsd = spendUsd
            }

            sharesAdded[plan.targetStock] = (sharesAdded[plan.targetStock] ?? 0) + bought
            reinvestedAmount += costUsd
          }
        }
      }

      const endingShares: TimelineShares = { ...startingShares }
      for (const [sym, inc] of Object.entries(sharesAdded)) {
        endingShares[sym] = Number(endingShares[sym] ?? 0) + Number(inc ?? 0)
      }

      // Next-week dividend estimate
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
  }, [plans, history, holdingsRows])

  if (isLoading) {
    return (
      <section className="panel" aria-label={t('timeline.ariaLabel')}>
        <h2>{t('timeline.summary.title')}</h2>
        <p className="empty">{t('common.loading')}</p>
      </section>
    )
  }

  // Pass null for reinvestmentRules since we use generator
  return (
    <ReinvestmentTimeline
      initialMonth={initialMY.month}
      initialYear={initialMY.year}
      compoundingStartMonth={compoundingStartMonth}
      compoundingStartYear={compoundingStartYear}
      holdings={baselineHoldings}
      reinvestmentRules={null as any}
      reinvestmentExecutions={executionWeeks}
      generateWeeklyReinvestmentTimeline={generator}
    />
  )
}
