export type DividendIncomes = {
  yearly: number
  monthly: number
  weekly: number
}

export type DividendFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type DividendIncomePeriod = keyof DividendIncomes

export function calcDividendIncomes(
  shares: number,
  dividendPerShare: number,
  dividendFrequency: DividendFrequency,
): DividendIncomes {
  const base = shares * dividendPerShare
  switch (dividendFrequency) {
    case 'weekly':
      return { weekly: base, monthly: 0, yearly: 0 }
    case 'monthly':
      return { weekly: 0, monthly: base, yearly: 0 }
    case 'yearly':
      return { weekly: 0, monthly: 0, yearly: base }
  }
}

export function calcDividendIncomesAnnualized(
  shares: number,
  dividendPerShare: number,
  dividendFrequency: DividendFrequency,
): DividendIncomes {
  const base = shares * dividendPerShare
  if (!Number.isFinite(base) || base < 0) return { weekly: 0, monthly: 0, yearly: 0 }

  // Simple calendar normalization for planning estimates.
  // Assumptions (per app UX): 4 weeks/month, 12 months/year.
  const weeksPerMonth = 4
  const monthsPerYear = 12
  const weeksPerYear = weeksPerMonth * monthsPerYear
  switch (dividendFrequency) {
    case 'weekly': {
      const yearly = base * weeksPerYear
      const monthly = yearly / monthsPerYear
      return { weekly: base, monthly, yearly }
    }
    case 'monthly': {
      const yearly = base * monthsPerYear
      const weekly = yearly / weeksPerYear
      return { weekly, monthly: base, yearly }
    }
    case 'yearly': {
      const monthly = base / monthsPerYear
      const weekly = base / weeksPerYear
      return { weekly, monthly, yearly: base }
    }
  }
}
