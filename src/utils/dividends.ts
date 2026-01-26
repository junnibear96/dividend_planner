export type DividendIncomes = {
  yearly: number
  halfYearly: number
  quarterly: number
  monthly: number
  weekly: number
}

export type DividendFrequency = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'

export type DividendIncomePeriod = keyof DividendIncomes

export function calcDividendIncomes(
  shares: number,
  dividendPerShare: number,
  dividendFrequency: DividendFrequency,
): DividendIncomes {
  const base = shares * dividendPerShare
  switch (dividendFrequency) {
    case 'weekly':
      return { weekly: base, monthly: 0, quarterly: 0, halfYearly: 0, yearly: 0 }
    case 'monthly':
      return { weekly: 0, monthly: base, quarterly: 0, halfYearly: 0, yearly: 0 }
    case 'quarterly':
      return { weekly: 0, monthly: 0, quarterly: base, halfYearly: 0, yearly: 0 }
    case 'half-yearly':
      return { weekly: 0, monthly: 0, quarterly: 0, halfYearly: base, yearly: 0 }
    case 'yearly':
      return { weekly: 0, monthly: 0, quarterly: 0, halfYearly: 0, yearly: base }
  }
}

export function calcDividendIncomesAnnualized(
  shares: number,
  dividendPerShare: number,
  dividendFrequency: DividendFrequency,
): DividendIncomes {
  const base = shares * dividendPerShare
  if (!Number.isFinite(base) || base < 0) return { weekly: 0, monthly: 0, quarterly: 0, halfYearly: 0, yearly: 0 }

  // Simple calendar normalization for planning estimates.
  // Assumptions (per app UX): 4 weeks/month, 12 months/year.
  const weeksPerMonth = 4
  const monthsPerYear = 12
  const weeksPerYear = weeksPerMonth * monthsPerYear
  switch (dividendFrequency) {
    case 'weekly': {
      const yearly = base * weeksPerYear
      const monthly = yearly / monthsPerYear
      const quarterly = yearly / 4
      const halfYearly = yearly / 2
      return { weekly: base, monthly, quarterly, halfYearly, yearly }
    }
    case 'monthly': {
      const yearly = base * monthsPerYear
      const weekly = yearly / weeksPerYear
      const quarterly = yearly / 4
      const halfYearly = yearly / 2
      return { weekly, monthly: base, quarterly, halfYearly, yearly }
    }
    case 'quarterly': {
      const yearly = base * 4
      const weekly = yearly / weeksPerYear
      const monthly = yearly / monthsPerYear
      const halfYearly = yearly / 2
      return { weekly, monthly, quarterly: base, halfYearly, yearly }
    }
    case 'half-yearly': {
      const yearly = base * 2
      const weekly = yearly / weeksPerYear
      const monthly = yearly / monthsPerYear
      const quarterly = yearly / 2
      return { weekly, monthly, quarterly, halfYearly: base, yearly }
    }
    case 'yearly': {
      const monthly = base / monthsPerYear
      const weekly = base / weeksPerYear
      const quarterly = base / 4
      const halfYearly = base / 2
      return { weekly, monthly, quarterly, halfYearly, yearly: base }
    }
  }
}
