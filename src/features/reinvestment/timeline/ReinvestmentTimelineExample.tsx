import ReinvestmentTimeline from './ReinvestmentTimeline'
import type { GenerateWeeklyReinvestmentTimeline, Holdings, ReinvestmentExecutionWeek, TimelineShares } from './types'

function addShares(base: TimelineShares, delta: TimelineShares): TimelineShares {
  const next: TimelineShares = { ...base }
  for (const [sym, inc] of Object.entries(delta)) {
    next[sym] = Number(next[sym] ?? 0) + Number(inc ?? 0)
  }
  return next
}

const exampleHoldings: Holdings = {
  sharesBySymbol: {
    'SCHD.US': 120.0,
    'VTI.US': 42.5,
  },
}

const exampleRules = {
  // Placeholder object; your real project can pass the actual rule set.
  destination: {
    weights: {
      'SCHD.US': 0.7,
      'VTI.US': 0.3,
    },
  },
}

const exampleExecutions: ReinvestmentExecutionWeek[] = [
  {
    executedAt: '2025-03-08T10:00:00.000Z',
    reinvestedAmount: 52.25,
    dividendEarned: 52.25,
    sharesAdded: {
      'SCHD.US': 0.410000,
      'VTI.US': 0.090000,
    },
  },
  {
    executedAt: '2025-03-16T10:00:00.000Z',
    reinvestedAmount: 51.10,
    dividendEarned: 51.10,
    sharesAdded: {
      'SCHD.US': 0.395000,
      'VTI.US': 0.095000,
    },
  },
]

const exampleGenerate: GenerateWeeklyReinvestmentTimeline = ({ startingShares, reinvestmentRules }) => {
  // Deterministic example projection (no prices/APIs):
  // - dividend is proportional to current shares
  // - reinvest entire dividend
  // - allocate purchases by rule weights
  const weights: Record<string, number> = (reinvestmentRules as any)?.destination?.weights ?? {}

  let shareSum = 0
  for (const v of Object.values(startingShares)) shareSum += Number(v) || 0

  const dividendEarned = Math.max(0, shareSum * 0.08)
  const reinvestedAmount = dividendEarned

  const sharesAdded: TimelineShares = {}
  const wEntries = Object.entries(weights)
  const totalW = wEntries.reduce((acc, [, w]) => acc + (Number(w) > 0 ? Number(w) : 0), 0)

  // Assume $100/share constant for deterministic example.
  const assumedPrice = 100
  if (totalW > 0 && assumedPrice > 0) {
    for (const [sym, w] of wEntries) {
      const ww = Number(w)
      if (!Number.isFinite(ww) || ww <= 0) continue
      const dollars = (reinvestedAmount * ww) / totalW
      sharesAdded[sym] = dollars / assumedPrice
    }
  }

  const endingShares = addShares(startingShares, sharesAdded)

  // Naive next-week estimate: recompute based on ending shares.
  let nextSum = 0
  for (const v of Object.values(endingShares)) nextSum += Number(v) || 0
  const nextWeekDividendEstimate = Math.max(0, nextSum * 0.08)

  return { dividendEarned, reinvestedAmount, sharesAdded, endingShares, nextWeekDividendEstimate }
}

export default function ReinvestmentTimelineExample() {
  return (
    <ReinvestmentTimeline
      initialMonth={3}
      initialYear={2025}
      compoundingStartMonth={1}
      compoundingStartYear={2025}
      holdings={exampleHoldings}
      reinvestmentRules={exampleRules}
      reinvestmentExecutions={exampleExecutions}
      generateWeeklyReinvestmentTimeline={exampleGenerate}
      // Freeze 'now' for deterministic example CURRENT highlighting.
      now={new Date('2025-03-16T12:00:00.000Z')}
    />
  )
}
