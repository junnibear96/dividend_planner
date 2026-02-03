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

export type DividendEvent = {
  symbol: string
  date: string
  value: number
}

export async function fetchReinvestmentSimulationEvents(): Promise<{ events: DividendEvent[] }> {
  const res = await fetch('/api/reinvestment/simulation-events')
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to load dividend events (${res.status})`)
  }
  return (await res.json()) as { events: DividendEvent[] }
}

export async function executeReinvestment(
  payload: {
    date: string
    cost: number
    items: { symbol: string; shares: number; price: number }[]
    weekIndex?: number
  }
): Promise<void> {
  const res = await fetch('/api/reinvestment/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to execute reinvestment (${res.status})`)
  }
}


// Collection Plans Types
export type CollectionPlanFrequency = 'daily' | 'weekly' | 'monthly'
export type CollectionPlanStatus = 'ACTIVE' | 'PAUSED'
export type InvestmentType = 'AMOUNT' | 'QUANTITY'
export type Currency = 'USD' | 'KRW'

export type CollectionPlan = {
  id: number
  userId: string
  targetStock: string
  frequency: CollectionPlanFrequency
  investmentType: InvestmentType
  currency: Currency
  amount: number
  autoDeposit: boolean
  startDate: string // YYYY-MM-DD
  status: CollectionPlanStatus
  createdAt: string
}

export async function fetchCollectionPlans(): Promise<CollectionPlan[]> {
  const res = await fetch('/api/plans')
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to load collection plans (${res.status})`)
  }
  const data = (await res.json()) as { plans: CollectionPlan[] }
  return data.plans
}

export async function createCollectionPlan(
  plan: Pick<CollectionPlan, 'targetStock' | 'frequency' | 'investmentType' | 'currency' | 'amount' | 'autoDeposit' | 'startDate'>
): Promise<CollectionPlan> {
  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to create collection plan (${res.status})`)
  }
  return (await res.json()) as CollectionPlan
}

export async function updateCollectionPlan(
  planId: number,
  updates: Partial<Pick<CollectionPlan, 'amount' | 'status' | 'frequency'>>
): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(String(planId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to update collection plan (${res.status})`)
  }
}

export async function deleteCollectionPlan(planId: number): Promise<void> {
  const res = await fetch(`/api/plans/${encodeURIComponent(String(planId))}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to delete collection plan (${res.status})`)
  }
}
export type ProjectionResult = {
  totalInvested: number
  finalPortfolioValue: number
  totalShares: number
  chartData: {
    date: string
    invested: number
    value: number
    shares: number
  }[]
}

export async function fetchSimulationProjection(
  timeframeYears: number,
  assumedAnnualReturn: number = 0.10
): Promise<ProjectionResult> {
  const res = await fetch('/api/simulation/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeframeYears, assumedAnnualReturn }),
  })
  if (!res.ok) {
    const body = (await jsonOrNull(res)) as { error?: string } | null
    throw new Error(body?.error ?? `Failed to run simulation (${res.status})`)
  }
  return (await res.json()) as ProjectionResult
}
