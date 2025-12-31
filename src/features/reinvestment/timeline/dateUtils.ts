export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
export const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

export type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export function isValidMonthNumber(m: number): m is MonthNumber {
  return Number.isInteger(m) && m >= 1 && m <= 12
}

export function makeUtcDate(year: number, month: MonthNumber, day: number): Date {
  // Creates a UTC date at 00:00:00.000Z (deterministic across locales).
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
}

export function toUtcDateOnly(d: Date): Date {
  return makeUtcDate(d.getUTCFullYear(), (d.getUTCMonth() + 1) as MonthNumber, d.getUTCDate())
}

export function addDaysUtc(d: Date, days: number): Date {
  // Adds days in UTC, preserving deterministic midnight semantics.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days, 0, 0, 0, 0))
}

export function startOfWeekUtc(d: Date, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): Date {
  const dd = toUtcDateOnly(d)
  const dow = dd.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const offset = (dow - weekStartsOn + 7) % 7
  return addDaysUtc(dd, -offset)
}

export function daysInMonthUtc(year: number, month: MonthNumber): number {
  // Day 0 of next month is last day of requested month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addMonths(year: number, month: MonthNumber, delta: number): { year: number; month: MonthNumber } {
  const zeroBased = (month - 1) + delta
  const nextYear = year + Math.floor(zeroBased / 12)
  const nextMonth0 = ((zeroBased % 12) + 12) % 12
  return { year: nextYear, month: (nextMonth0 + 1) as MonthNumber }
}

export function compareDateOnlyUtc(a: Date, b: Date): number {
  const aa = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const bb = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return aa === bb ? 0 : aa < bb ? -1 : 1
}

export function isDateInRangeUtc(d: Date, startInclusive: Date, endInclusive: Date): boolean {
  return compareDateOnlyUtc(d, startInclusive) >= 0 && compareDateOnlyUtc(d, endInclusive) <= 0
}

export function monthLabel(month: MonthNumber): string {
  return MONTH_NAMES_FULL[month - 1]
}

export function monthLabelShort(month: MonthNumber): string {
  return MONTH_NAMES_SHORT[month - 1]
}
