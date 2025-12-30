export type RuleFrequency = 'weekly' | 'biweekly' | 'monthly'
export type ScheduleMode = 'FIXED' | 'WEEK_OF_MONTH'
export type SourceScope = 'ALL' | 'SELECTED'
export type DestinationType = 'SAME_AS_SOURCE' | 'SINGLE_ASSET' | 'ALLOCATION_BASKET'

export type RuleDestinationAsset = {
  symbol: string
  weight?: number
}

export type ReinvestmentRule = {
  id: string
  enabled: boolean
  sourceScope: SourceScope
  destinationType: DestinationType
  destinationAssets: RuleDestinationAsset[]
  scheduleMode: ScheduleMode
  frequency: RuleFrequency
  weekDestinations?: Record<1 | 2 | 3 | 4, { destinationType: DestinationType; destinationAssets: RuleDestinationAsset[] }>
  minimumAmount: number
  fractionalSharesAllowed: boolean
}

export type ReinvestmentSummary = {
  dividendCashAvailable: number
  nextReinvestmentDate: string | null
  rule: ReinvestmentRule
}

export type ExecutionDetail = {
  symbol: string
  weight: number
  allocatedAmount: number
  price: number
  sharesBought: number
  spentAmount: number
}

export type ReinvestmentExecution = {
  id: string
  ruleId: string
  executionDate: string
  executedAt: string
  weekIndex: number | null
  totalAmount: number
  executionDetails: {
    sourceScope: SourceScope
    sourceSymbols: string[]
    fractionalSharesAllowed: boolean
    details: ExecutionDetail[]
    leftoverUnspent: number
  }
}

async function jsonOrNull(res: Response) {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export async function fetchReinvestmentSummary(): Promise<ReinvestmentSummary> {
  const res = await fetch('/api/reinvestment/summary')
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to load reinvestment summary (${res.status})`)
  }
  return (await res.json()) as ReinvestmentSummary
}

export async function updateReinvestmentRule(
  patch: Partial<Omit<ReinvestmentRule, 'id'>>,
): Promise<{ rule: ReinvestmentRule; nextReinvestmentDate: string | null; dividendCashAvailable: number }> {
  const res = await fetch('/api/reinvestment/rule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to update reinvestment rule (${res.status})`)
  }

  return (await res.json()) as {
    rule: ReinvestmentRule
    nextReinvestmentDate: string | null
    dividendCashAvailable: number
  }
}

export async function fetchReinvestmentHistory(
  limit: number = 50,
): Promise<{ executions: ReinvestmentExecution[] }> {
  const res = await fetch(`/api/reinvestment/history?limit=${encodeURIComponent(String(limit))}`)
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to load reinvestment history (${res.status})`)
  }
  return (await res.json()) as { executions: ReinvestmentExecution[] }
}
