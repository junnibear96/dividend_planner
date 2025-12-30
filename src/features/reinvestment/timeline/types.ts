export type WeekStatus = 'PAST' | 'CURRENT' | 'FUTURE'

export type TimelineShares = Record<string, number>

export type WeeklySlice = {
  weekIndex: number // 1..4 or 5
  startDate: Date
  endDate: Date
  status: WeekStatus
  startingShares: TimelineShares
  dividendEarned: number
  reinvestedAmount: number
  sharesAdded: TimelineShares
  endingShares: TimelineShares
  nextWeekDividendEstimate: number
}

export type Holdings = {
  // Symbol -> shares (simulation state baseline)
  sharesBySymbol: TimelineShares
}

export type ReinvestmentExecutionWeek = {
  // Execution timestamp (ISO string); used to map into a month/week slice
  executedAt: string

  // Total dollars reinvested in that execution
  reinvestedAmount: number

  // Optional: dividends earned that led to this reinvestment
  dividendEarned?: number

  // Purchases (shares added per symbol)
  sharesAdded: TimelineShares
}

export type GenerateWeeklyReinvestmentTimeline = (input: {
  startDate: Date
  endDate: Date
  weekIndex: number
  startingShares: TimelineShares
  holdings: Holdings
  reinvestmentRules: unknown
}) => {
  dividendEarned: number
  reinvestedAmount: number
  sharesAdded: TimelineShares
  endingShares: TimelineShares
  nextWeekDividendEstimate: number
}
