import { addMonths, compareDateOnlyUtc, daysInMonthUtc, isDateInRangeUtc, makeUtcDate, type MonthNumber, toUtcDateOnly } from './dateUtils'
import type {
  GenerateWeeklyReinvestmentTimeline,
  Holdings,
  ReinvestmentExecutionWeek,
  TimelineShares,
  WeeklySlice,
  WeekStatus,
} from './types'

function shallowCloneShares(shares: TimelineShares): TimelineShares {
  return { ...shares }
}

function addShares(base: TimelineShares, delta: TimelineShares): TimelineShares {
  const next: TimelineShares = { ...base }
  for (const [sym, inc] of Object.entries(delta)) {
    const cur = Number(next[sym] ?? 0)
    const add = Number(inc ?? 0)
    next[sym] = cur + (Number.isFinite(add) ? add : 0)
  }
  return next
}

function emptyShares(): TimelineShares {
  return {}
}

export function deriveWeeksForMonthUtc(year: number, month: MonthNumber): Array<{ weekIndex: number; startDate: Date; endDate: Date }> {
  const lastDay = daysInMonthUtc(year, month)
  const weeks: Array<{ weekIndex: number; startDate: Date; endDate: Date }> = []

  const boundaries: Array<{ weekIndex: number; startDay: number; endDay: number }> = [
    { weekIndex: 1, startDay: 1, endDay: 7 },
    { weekIndex: 2, startDay: 8, endDay: 14 },
    { weekIndex: 3, startDay: 15, endDay: 21 },
    { weekIndex: 4, startDay: 22, endDay: 28 },
  ]

  for (const b of boundaries) {
    if (b.startDay > lastDay) break
    weeks.push({
      weekIndex: b.weekIndex,
      startDate: makeUtcDate(year, month, b.startDay),
      endDate: makeUtcDate(year, month, Math.min(b.endDay, lastDay)),
    })
  }

  if (lastDay > 28) {
    weeks.push({
      weekIndex: 5,
      startDate: makeUtcDate(year, month, 29),
      endDate: makeUtcDate(year, month, lastDay),
    })
  }

  return weeks
}

function weekStatusUtc(now: Date, startDate: Date, endDate: Date): WeekStatus {
  const n = toUtcDateOnly(now)
  if (compareDateOnlyUtc(endDate, n) < 0) return 'PAST'
  if (compareDateOnlyUtc(startDate, n) > 0) return 'FUTURE'
  return 'CURRENT'
}

function pickExecutionForWeek(
  executions: ReinvestmentExecutionWeek[],
  startDate: Date,
  endDate: Date,
): ReinvestmentExecutionWeek | null {
  // If multiple executions land in the same slice, pick the last executedAt.
  let best: ReinvestmentExecutionWeek | null = null
  for (const ex of executions) {
    const d = new Date(ex.executedAt)
    if (!Number.isFinite(d.getTime())) continue
    if (!isDateInRangeUtc(d, startDate, endDate)) continue
    if (!best) {
      best = ex
      continue
    }
    const bd = new Date(best.executedAt)
    if (d.getTime() > bd.getTime()) best = ex
  }
  return best
}

function zeroIfInvalid(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function normalizeShares(shares: TimelineShares | undefined): TimelineShares {
  const out: TimelineShares = {}
  if (!shares) return out
  for (const [k, v] of Object.entries(shares)) {
    const num = Number(v)
    out[k] = Number.isFinite(num) ? num : 0
  }
  return out
}

export type BuildMonthlyTimelineInput = {
  selectedYear: number
  selectedMonth: MonthNumber

  // Anchor month for compounding (ending shares flow month-to-month from this point).
  compoundingStartYear: number
  compoundingStartMonth: MonthNumber

  holdings: Holdings
  reinvestmentRules: unknown

  // Past weeks.
  reinvestmentExecutions: ReinvestmentExecutionWeek[]

  // Projection engine for CURRENT/FUTURE (and optionally to estimate next week after past executions).
  generateWeeklyReinvestmentTimeline?: GenerateWeeklyReinvestmentTimeline

  // For deterministic testing and predictable UI.
  now?: Date
}

export function buildMonthlyTimeline(input: BuildMonthlyTimelineInput): WeeklySlice[] {
  const {
    selectedYear,
    selectedMonth,
    compoundingStartYear,
    compoundingStartMonth,
    holdings,
    reinvestmentRules,
    reinvestmentExecutions,
    generateWeeklyReinvestmentTimeline,
  } = input

  const now = input.now ?? new Date()

  // Validate ordering: if selected month is before compounding start, we still generate from selected month
  // (so UI works deterministically), but compounding scope is limited to the visible range.
  let startYear = compoundingStartYear
  let startMonth = compoundingStartMonth

  const startKey = startYear * 12 + (startMonth - 1)
  const selectedKey = selectedYear * 12 + (selectedMonth - 1)
  if (selectedKey < startKey) {
    startYear = selectedYear
    startMonth = selectedMonth
  }

  let cursorYear = startYear
  let cursorMonth = startMonth

  let carryShares: TimelineShares = shallowCloneShares(holdings.sharesBySymbol)
  let selectedMonthWeeks: WeeklySlice[] = []

  while (cursorYear * 12 + (cursorMonth - 1) <= selectedKey) {
    const weeks = deriveWeeksForMonthUtc(cursorYear, cursorMonth)

    const monthWeeks: WeeklySlice[] = []
    for (const w of weeks) {
      const status = weekStatusUtc(now, w.startDate, w.endDate)
      const startingShares = shallowCloneShares(carryShares)

      const exec = pickExecutionForWeek(reinvestmentExecutions, w.startDate, w.endDate)
      if (exec) {
        const sharesAdded = normalizeShares(exec.sharesAdded)
        const dividendEarned = zeroIfInvalid(exec.dividendEarned ?? exec.reinvestedAmount)
        const reinvestedAmount = zeroIfInvalid(exec.reinvestedAmount)
        const endingShares = addShares(startingShares, sharesAdded)

        let nextWeekDividendEstimate = 0
        if (generateWeeklyReinvestmentTimeline) {
          // Estimate next week using the post-execution state.
          const next = generateWeeklyReinvestmentTimeline({
            startDate: w.startDate,
            endDate: w.endDate,
            weekIndex: w.weekIndex,
            startingShares: endingShares,
            holdings: { ...holdings, sharesBySymbol: endingShares },
            reinvestmentRules,
          })
          nextWeekDividendEstimate = zeroIfInvalid(next.nextWeekDividendEstimate)
        }

        monthWeeks.push({
          weekIndex: w.weekIndex,
          startDate: w.startDate,
          endDate: w.endDate,
          status,
          startingShares,
          dividendEarned,
          reinvestedAmount,
          sharesAdded,
          endingShares,
          nextWeekDividendEstimate,
        })

        carryShares = endingShares
        continue
      }

      if (generateWeeklyReinvestmentTimeline && (status === 'CURRENT' || status === 'FUTURE')) {
        const projected = generateWeeklyReinvestmentTimeline({
          startDate: w.startDate,
          endDate: w.endDate,
          weekIndex: w.weekIndex,
          startingShares,
          holdings: { ...holdings, sharesBySymbol: startingShares },
          reinvestmentRules,
        })

        const endingShares = normalizeShares(projected.endingShares)
        monthWeeks.push({
          weekIndex: w.weekIndex,
          startDate: w.startDate,
          endDate: w.endDate,
          status,
          startingShares,
          dividendEarned: zeroIfInvalid(projected.dividendEarned),
          reinvestedAmount: zeroIfInvalid(projected.reinvestedAmount),
          sharesAdded: normalizeShares(projected.sharesAdded),
          endingShares,
          nextWeekDividendEstimate: zeroIfInvalid(projected.nextWeekDividendEstimate),
        })
        carryShares = endingShares
        continue
      }

      // PAST week with no execution data: deterministic no-op.
      monthWeeks.push({
        weekIndex: w.weekIndex,
        startDate: w.startDate,
        endDate: w.endDate,
        status,
        startingShares,
        dividendEarned: 0,
        reinvestedAmount: 0,
        sharesAdded: emptyShares(),
        endingShares: shallowCloneShares(startingShares),
        nextWeekDividendEstimate: 0,
      })

      carryShares = shallowCloneShares(startingShares)
    }

    if (cursorYear === selectedYear && cursorMonth === selectedMonth) {
      selectedMonthWeeks = monthWeeks
    }

    const next = addMonths(cursorYear, cursorMonth, 1)
    cursorYear = next.year
    cursorMonth = next.month
  }

  return selectedMonthWeeks
}
