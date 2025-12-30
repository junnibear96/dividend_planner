import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'

export type DividendFrequency = 'weekly' | 'monthly' | 'yearly'
export type RuleFrequency = 'weekly' | 'biweekly' | 'monthly'
export type SourceScope = 'ALL' | 'SELECTED'
export type DestinationType = 'SAME_AS_SOURCE' | 'SINGLE_ASSET' | 'ALLOCATION_BASKET'
export type ScheduleMode = 'FIXED' | 'WEEK_OF_MONTH'

export type DividendCashPool = {
  id: string
  availableBalance: number
}

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

function toSqlDateUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseSqlDate(date: string): Date {
  const [y, m, d] = date.split('-').map((x) => Number(x))
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0))
}

function daysInMonthUtc(y: number, m1: number): number {
  // m1 is 1-12
  return new Date(Date.UTC(y, m1, 0)).getUTCDate()
}

function getWeekIndexForDateUtc(d: Date): 1 | 2 | 3 | 4 {
  const day = d.getUTCDate()
  const idx = Math.floor((day - 1) / 7) + 1
  return (Math.min(4, Math.max(1, idx)) as 1 | 2 | 3 | 4)
}

function getWeekWindowForDateUtc(d: Date): { weekIndex: 1 | 2 | 3 | 4; start: Date; end: Date } {
  const y = d.getUTCFullYear()
  const m0 = d.getUTCMonth()
  const m1 = m0 + 1
  const weekIndex = getWeekIndexForDateUtc(d)

  const startDay = 1 + (weekIndex - 1) * 7
  const lastDay = daysInMonthUtc(y, m1)
  const endDay = weekIndex === 4 ? lastDay : Math.min(lastDay, startDay + 6)

  const start = new Date(Date.UTC(y, m0, startDay, 0, 0, 0, 0))
  const end = new Date(Date.UTC(y, m0, endDay, 23, 59, 59, 999))
  return { weekIndex, start, end }
}

function addPeriod(date: Date, frequency: DividendFrequency | RuleFrequency): Date {
  const next = new Date(date.getTime())
  if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7)
    return next
  }
  if (frequency === 'biweekly') {
    next.setUTCDate(next.getUTCDate() + 14)
    return next
  }
  if (frequency === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + 1)
    return next
  }
  next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}

function safeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return n
}

function normalizeSymbol(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

function normalizeWeights(
  assets: Array<{ symbol: string; weight?: number }>,
): Array<{ symbol: string; weight: number }> {
  const normalized = assets
    .map((a) => ({ symbol: normalizeSymbol(a.symbol), weight: safeNumber(a.weight) ?? 0 }))
    .filter((a) => Boolean(a.symbol) && Number.isFinite(a.weight) && a.weight > 0)

  const sum = normalized.reduce((s, a) => s + a.weight, 0)
  if (!Number.isFinite(sum) || sum <= 0) return []

  return normalized.map((a) => ({ ...a, weight: a.weight / sum }))
}

async function upsertCashPool(conn: mysql.PoolConnection, userId: string): Promise<DividendCashPool> {
  const [sumRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM dividend_accruals
     WHERE user_id = :userId AND consumed_execution_id IS NULL`,
    { userId },
  )
  const balance = Number((sumRows[0] as { balance: number }).balance)

  const [poolRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id FROM dividend_cash_pool WHERE user_id = :userId LIMIT 1`,
    { userId },
  )
  let poolId = (poolRows[0] as { id: string } | undefined)?.id
  if (!poolId) {
    poolId = randomUUID()
    await conn.execute(
      `INSERT INTO dividend_cash_pool (id, user_id, available_balance)
       VALUES (:id, :userId, :balance)`,
      { id: poolId, userId, balance },
    )
  } else {
    await conn.execute(
      `UPDATE dividend_cash_pool SET available_balance = :balance WHERE user_id = :userId`,
      { userId, balance },
    )
  }

  return { id: poolId, availableBalance: balance }
}

async function getOrCreateRule(conn: mysql.PoolConnection, userId: string): Promise<ReinvestmentRule> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT
        id,
        enabled,
        source_scope AS sourceScope,
        destination_type AS destinationType,
        destination_assets AS destinationAssets,
        schedule_mode AS scheduleMode,
        frequency,
        week_destinations AS weekDestinations,
        minimum_amount AS minimumAmount,
        fractional_shares_allowed AS fractionalSharesAllowed
     FROM reinvestment_rules
     WHERE user_id = :userId
     ORDER BY updated_at DESC
     LIMIT 1`,
    { userId },
  )

  const row = rows[0] as
    | {
        id: string
        enabled: number
        sourceScope: SourceScope
        destinationType: DestinationType
        destinationAssets: unknown
        scheduleMode?: ScheduleMode
        frequency: RuleFrequency
        weekDestinations?: unknown
        minimumAmount: number
        fractionalSharesAllowed: number
      }
    | undefined

  if (row) {
    const assets = Array.isArray(row.destinationAssets)
      ? (row.destinationAssets as unknown[])
      : typeof row.destinationAssets === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(row.destinationAssets)
              return Array.isArray(parsed) ? parsed : []
            } catch {
              return []
            }
          })()
        : []

    const destinationAssets: RuleDestinationAsset[] = assets
      .map((a) => (a ?? {}) as Record<string, unknown>)
      .map((a) => ({
        symbol: normalizeSymbol(a.symbol),
        weight: safeNumber(a.weight) ?? undefined,
      }))
      .filter((a) => Boolean(a.symbol))


    let weekDestinationsParsed: ReinvestmentRule['weekDestinations'] = undefined
    const rawWeek = (row as { weekDestinations?: unknown }).weekDestinations
    let weekObj: any = rawWeek
    if (typeof weekObj === 'string') {
      try {
        weekObj = JSON.parse(weekObj)
      } catch {
        weekObj = null
      }
    }
    if (weekObj && typeof weekObj === 'object') {
      const out: any = {}
      for (const k of ['1', '2', '3', '4'] as const) {
        const v = (weekObj as any)[k]
        if (!v || typeof v !== 'object') continue
        const dt = String((v as any).destinationType ?? '') as DestinationType
        const daRaw = (v as any).destinationAssets
        const da = Array.isArray(daRaw)
          ? daRaw
              .map((a: any) => ({ symbol: normalizeSymbol(a?.symbol), weight: safeNumber(a?.weight) ?? undefined }))
              .filter((a: any) => Boolean(a.symbol))
          : []
        if (dt === 'SAME_AS_SOURCE' || dt === 'SINGLE_ASSET' || dt === 'ALLOCATION_BASKET') {
          out[Number(k)] = { destinationType: dt, destinationAssets: da }
        }
      }
      if (Object.keys(out).length) weekDestinationsParsed = out as ReinvestmentRule['weekDestinations']
    }

    let scheduleMode: ScheduleMode = (row.scheduleMode ?? 'FIXED') === 'WEEK_OF_MONTH' ? 'WEEK_OF_MONTH' : 'FIXED'
    let weekDestinations: ReinvestmentRule['weekDestinations'] = weekDestinationsParsed

    // Legacy default rules used FIXED schedule_mode. If the user hasn't customized anything,
    // migrate them to WEEK_OF_MONTH so Week 1–4 is the default setup.
    const looksLikeLegacyDefault =
      !Boolean(row.enabled) &&
      row.sourceScope === 'ALL' &&
      row.destinationType === 'SAME_AS_SOURCE' &&
      destinationAssets.length === 0 &&
      row.frequency === 'weekly' &&
      Number(row.minimumAmount) === 10 &&
      Boolean(row.fractionalSharesAllowed) === true

    if (scheduleMode === 'FIXED' && !weekDestinations && looksLikeLegacyDefault) {
      const baseWeekDestination = {
        destinationType: 'SAME_AS_SOURCE' as const,
        destinationAssets: [] as Array<{ symbol: string; weight?: number }>,
      }
      weekDestinations = {
        1: baseWeekDestination,
        2: baseWeekDestination,
        3: baseWeekDestination,
        4: baseWeekDestination,
      }
      scheduleMode = 'WEEK_OF_MONTH'

      await conn.execute(
        `UPDATE reinvestment_rules
         SET schedule_mode = 'WEEK_OF_MONTH',
             week_destinations = :weekDestinations
         WHERE id = :id`,
        { id: row.id, weekDestinations: JSON.stringify(weekDestinations) },
      )
    }

    return {
      id: row.id,
      enabled: Boolean(row.enabled),
      sourceScope: row.sourceScope,
      destinationType: row.destinationType,
      destinationAssets,
      scheduleMode,
      frequency: row.frequency,
      weekDestinations,
      minimumAmount: Number(row.minimumAmount),
      fractionalSharesAllowed: Boolean(row.fractionalSharesAllowed),
    }
  }

  const id = randomUUID()
  const baseWeekDestination = {
    destinationType: 'SAME_AS_SOURCE' as const,
    destinationAssets: [] as Array<{ symbol: string; weight?: number }>,
  }
  const defaultRule: ReinvestmentRule = {
    id,
    enabled: false,
    sourceScope: 'ALL',
    destinationType: 'SAME_AS_SOURCE',
    destinationAssets: [],
    scheduleMode: 'WEEK_OF_MONTH',
    frequency: 'weekly',
    weekDestinations: {
      1: baseWeekDestination,
      2: baseWeekDestination,
      3: baseWeekDestination,
      4: baseWeekDestination,
    },
    minimumAmount: 10,
    fractionalSharesAllowed: true,
  }

  await conn.execute(
    `INSERT INTO reinvestment_rules (
        id,
        user_id,
        enabled,
        source_scope,
        destination_type,
        destination_assets,
        schedule_mode,
        frequency,
        week_destinations,
        minimum_amount,
        fractional_shares_allowed
     ) VALUES (
        :id,
        :userId,
        :enabled,
        :sourceScope,
        :destinationType,
        :destinationAssets,
        :scheduleMode,
        :frequency,
        :weekDestinations,
        :minimumAmount,
        :fractionalSharesAllowed
     )`,
    {
      id,
      userId,
      enabled: 0,
      sourceScope: defaultRule.sourceScope,
      destinationType: defaultRule.destinationType,
      destinationAssets: JSON.stringify(defaultRule.destinationAssets),
      scheduleMode: defaultRule.scheduleMode,
      frequency: defaultRule.frequency,
      weekDestinations: JSON.stringify(defaultRule.weekDestinations),
      minimumAmount: defaultRule.minimumAmount,
      fractionalSharesAllowed: 1,
    },
  )

  return defaultRule
}

async function getLastExecutionDate(
  conn: mysql.PoolConnection,
  userId: string,
  ruleId: string,
): Promise<string | null> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(execution_date), '%Y-%m-%d') AS d
     FROM reinvestment_executions
     WHERE user_id = :userId AND rule_id = :ruleId`,
    { userId, ruleId },
  )
  const d = (rows[0] as { d: string | null } | undefined)?.d ?? null
  return d
}

async function getLatestSimulatedPrice(conn: mysql.PoolConnection, symbol: string): Promise<number | null> {
  const [eodRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT close
     FROM stock_eod
     WHERE symbol = :symbol
     ORDER BY date DESC
     LIMIT 1`,
    { symbol },
  )
  const close = safeNumber((eodRows[0] as { close: unknown } | undefined)?.close)
  if (close !== null && close > 0) return close

  const [rtRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT payload
     FROM stock_realtime
     WHERE symbol = :symbol
     LIMIT 1`,
    { symbol },
  )

  const payload = (rtRows[0] as { payload?: unknown } | undefined)?.payload
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>
      const candidates = [parsed.close, parsed.price, parsed.last, parsed.last_close]
      for (const c of candidates) {
        const n = safeNumber(c)
        if (n !== null && n > 0) return n
      }
    } catch {
      // ignore
    }
  }

  return null
}

async function accrueDividends(conn: mysql.PoolConnection, userId: string, todaySql: string): Promise<number> {
  // For determinism and simplicity, accrue at most one period per holding per run.
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT
      symbol,
      shares,
      dividend_per_share AS dividendPerShare,
      dividend_frequency AS dividendFrequency
     FROM holdings
     WHERE user_id = :userId`,
    { userId },
  )

  const today = parseSqlDate(todaySql)
  let inserted = 0

  for (const r of rows as unknown as Array<{ symbol: string; shares: number; dividendPerShare: number; dividendFrequency: DividendFrequency }>) {
    const symbol = normalizeSymbol(r.symbol)
    const shares = Number(r.shares)
    const dividendPerShare = Number(r.dividendPerShare)
    const frequency = r.dividendFrequency

    if (!symbol || !Number.isFinite(shares) || shares <= 0) continue
    if (!Number.isFinite(dividendPerShare) || dividendPerShare <= 0) continue

    const [lastRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(MAX(accrual_date), '%Y-%m-%d') AS d
       FROM dividend_accruals
       WHERE user_id = :userId AND symbol = :symbol AND frequency = :frequency`,
      { userId, symbol, frequency },
    )

    const last = (lastRows[0] as { d: string | null } | undefined)?.d ?? null
    const lastDate = last ? parseSqlDate(last) : null
    const nextAccrual = lastDate ? addPeriod(lastDate, frequency) : today

    if (nextAccrual.getTime() > today.getTime()) continue

    const amount = shares * dividendPerShare
    if (!Number.isFinite(amount) || amount <= 0) continue

    await conn.execute(
      `INSERT INTO dividend_accruals (id, user_id, symbol, amount, accrual_date, frequency)
       VALUES (:id, :userId, :symbol, :amount, :accrualDate, :frequency)`,
      {
        id: randomUUID(),
        userId,
        symbol,
        amount,
        accrualDate: toSqlDateUtc(nextAccrual),
        frequency,
      },
    )

    inserted += 1
  }

  return inserted
}

async function consumeAccrualsFifo(
  conn: mysql.PoolConnection,
  userId: string,
  executionId: string,
  eligibleSymbols: string[],
  amountToConsume: number,
): Promise<void> {
  let remaining = amountToConsume
  if (!Number.isFinite(remaining) || remaining <= 0) return

  const symbolParams: Record<string, unknown> = { userId }
  eligibleSymbols.forEach((s, i) => {
    symbolParams[`s${i}`] = s
  })
  const inSql = eligibleSymbols.map((_, i) => `:s${i}`).join(',')

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, symbol, amount, DATE_FORMAT(accrual_date, '%Y-%m-%d') AS accrualDate, frequency
     FROM dividend_accruals
     WHERE user_id = :userId AND consumed_execution_id IS NULL AND symbol IN (${inSql})
     ORDER BY accrual_date ASC, created_at ASC`,
    symbolParams,
  )

  for (const r of rows as unknown as Array<{ id: string; symbol: string; amount: number; accrualDate: string; frequency: DividendFrequency }>) {
    if (remaining <= 0) break

    const rowAmount = Number(r.amount)
    if (!Number.isFinite(rowAmount) || rowAmount <= 0) continue

    if (rowAmount <= remaining + 1e-9) {
      await conn.execute(
        `UPDATE dividend_accruals
         SET consumed_execution_id = :executionId
         WHERE id = :id AND user_id = :userId`,
        { id: r.id, userId, executionId },
      )
      remaining -= rowAmount
      continue
    }

    // Partial consumption: split row into consumed + leftover.
    const consumedAmount = remaining
    const leftoverAmount = rowAmount - remaining
    const leftoverId = randomUUID()

    await conn.execute(
      `UPDATE dividend_accruals
       SET amount = :amount, consumed_execution_id = :executionId
       WHERE id = :id AND user_id = :userId`,
      { id: r.id, userId, amount: consumedAmount, executionId },
    )

    await conn.execute(
      `INSERT INTO dividend_accruals (id, user_id, symbol, amount, accrual_date, frequency)
       VALUES (:id, :userId, :symbol, :amount, :accrualDate, :frequency)`,
      {
        id: leftoverId,
        userId,
        symbol: r.symbol,
        amount: leftoverAmount,
        accrualDate: r.accrualDate,
        frequency: r.frequency,
      },
    )

    remaining = 0
  }
}

async function runRuleExecutionIfDue(
  conn: mysql.PoolConnection,
  userId: string,
  todaySql: string,
  rule: ReinvestmentRule,
): Promise<ReinvestmentExecution | null> {
  if (!rule.enabled) return null

  let weekIndex: 1 | 2 | 3 | 4 | null = null

  if (rule.scheduleMode === 'WEEK_OF_MONTH') {
    const today = parseSqlDate(todaySql)
    const window = getWeekWindowForDateUtc(today)
    weekIndex = window.weekIndex

    const [alreadyRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM reinvestment_executions
       WHERE user_id = :userId
         AND rule_id = :ruleId
         AND week_index = :weekIndex
         AND execution_date BETWEEN :startDate AND :endDate`,
      {
        userId,
        ruleId: rule.id,
        weekIndex,
        startDate: toSqlDateUtc(window.start),
        endDate: toSqlDateUtc(window.end),
      },
    )
    const already = Number((alreadyRows[0] as { cnt: number }).cnt)
    if (already > 0) return null
  } else {
    const lastExec = await getLastExecutionDate(conn, userId, rule.id)
    const nextExec = lastExec ? toSqlDateUtc(addPeriod(parseSqlDate(lastExec), rule.frequency)) : todaySql
    if (parseSqlDate(todaySql).getTime() < parseSqlDate(nextExec).getTime()) return null
  }

  const [holdings] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT symbol, include_in_reinvestment AS includeInReinvestment
     FROM holdings
     WHERE user_id = :userId`,
    { userId },
  )

  const allSymbols = (holdings as unknown as Array<{ symbol: string }>).
    map((h) => normalizeSymbol(h.symbol)).filter(Boolean)
  const selectedSymbols = (holdings as unknown as Array<{ symbol: string; includeInReinvestment: number }>).
    filter((h) => Number(h.includeInReinvestment) === 1)
    .map((h) => normalizeSymbol(h.symbol))
    .filter(Boolean)

  const sourceSymbols = rule.sourceScope === 'ALL' ? allSymbols : selectedSymbols
  if (sourceSymbols.length === 0) return null

  const symbolParams: Record<string, unknown> = { userId }
  sourceSymbols.forEach((s, i) => {
    symbolParams[`s${i}`] = s
  })
  const inSql = sourceSymbols.map((_, i) => `:s${i}`).join(',')

  const [eligibleSumRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM dividend_accruals
     WHERE user_id = :userId AND consumed_execution_id IS NULL AND symbol IN (${inSql})`,
    symbolParams,
  )
  const eligibleBalance = Number((eligibleSumRows[0] as { balance: number }).balance)
  if (!Number.isFinite(eligibleBalance) || eligibleBalance < rule.minimumAmount) return null

  let destWeights: Array<{ symbol: string; weight: number }> = []

  const activeDestination =
    rule.scheduleMode === 'WEEK_OF_MONTH' && weekIndex && rule.weekDestinations && rule.weekDestinations[weekIndex]
      ? rule.weekDestinations[weekIndex]
      : { destinationType: rule.destinationType, destinationAssets: rule.destinationAssets }

  if (activeDestination.destinationType === 'SAME_AS_SOURCE') {
    const [bySymbol] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT symbol, COALESCE(SUM(amount), 0) AS amount
       FROM dividend_accruals
       WHERE user_id = :userId AND consumed_execution_id IS NULL AND symbol IN (${inSql})
       GROUP BY symbol`,
      symbolParams,
    )

    const assets = (bySymbol as unknown as Array<{ symbol: string; amount: number }>).map((r) => ({
      symbol: normalizeSymbol(r.symbol),
      weight: Number(r.amount),
    }))
    destWeights = normalizeWeights(assets)
  } else if (activeDestination.destinationType === 'SINGLE_ASSET') {
    const s = normalizeSymbol(activeDestination.destinationAssets[0]?.symbol)
    if (!s) return null
    destWeights = [{ symbol: s, weight: 1 }]
  } else {
    destWeights = normalizeWeights(activeDestination.destinationAssets)
  }

  if (destWeights.length === 0) return null

  const executionId = randomUUID()

  const details: ExecutionDetail[] = []
  let spentTotal = 0

  for (const a of destWeights) {
    const allocated = eligibleBalance * a.weight
    if (!Number.isFinite(allocated) || allocated <= 0) continue

    const price = await getLatestSimulatedPrice(conn, a.symbol)
    if (price === null || !Number.isFinite(price) || price <= 0) continue

    let sharesBought = allocated / price
    if (!rule.fractionalSharesAllowed) {
      sharesBought = Math.floor(sharesBought)
    }
    if (!Number.isFinite(sharesBought) || sharesBought <= 0) continue

    const spentAmount = sharesBought * price
    if (!Number.isFinite(spentAmount) || spentAmount <= 0) continue

    // Upsert holding shares (destination may be different from source)
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, shares
       FROM holdings
       WHERE user_id = :userId AND symbol = :symbol
       ORDER BY created_at DESC
       LIMIT 1`,
      { userId, symbol: a.symbol },
    )

    const row = existing[0] as { id: string; shares: number } | undefined
    if (row) {
      const nextShares = Number(row.shares) + sharesBought
      await conn.execute(
        `UPDATE holdings SET shares = :shares WHERE id = :id AND user_id = :userId`,
        { id: row.id, userId, shares: nextShares },
      )
    } else {
      await conn.execute(
        `INSERT INTO holdings (
          id,
          user_id,
          symbol,
          shares,
          dividend_per_share,
          dividend_frequency,
          include_in_reinvestment
        ) VALUES (
          :id,
          :userId,
          :symbol,
          :shares,
          :dividendPerShare,
          :dividendFrequency,
          :includeInReinvestment
        )`,
        {
          id: randomUUID(),
          userId,
          symbol: a.symbol,
          shares: sharesBought,
          dividendPerShare: 0,
          dividendFrequency: 'yearly',
          includeInReinvestment: 1,
        },
      )
    }

    details.push({
      symbol: a.symbol,
      weight: a.weight,
      allocatedAmount: allocated,
      price,
      sharesBought,
      spentAmount,
    })
    spentTotal += spentAmount
  }

  if (details.length === 0 || spentTotal <= 0) return null

  const leftover = Math.max(0, eligibleBalance - spentTotal)

  const executionDetails = {
    sourceScope: rule.sourceScope,
    sourceSymbols,
    fractionalSharesAllowed: rule.fractionalSharesAllowed,
    details,
    leftoverUnspent: leftover,
  }

  await conn.execute(
    `INSERT INTO reinvestment_executions (
      id,
      user_id,
      rule_id,
      execution_date,
      week_index,
      total_amount,
      execution_details
    ) VALUES (
      :id,
      :userId,
      :ruleId,
      :executionDate,
      :weekIndex,
      :totalAmount,
      :executionDetails
    )`,
    {
      id: executionId,
      userId,
      ruleId: rule.id,
      executionDate: todaySql,
      weekIndex,
      totalAmount: spentTotal,
      executionDetails: JSON.stringify(executionDetails),
    },
  )

  await consumeAccrualsFifo(conn, userId, executionId, sourceSymbols, spentTotal)

  const [createdRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS executedAt
     FROM reinvestment_executions
     WHERE id = :id AND user_id = :userId
     LIMIT 1`,
    { id: executionId, userId },
  )
  const executedAt =
    (createdRows[0] as { executedAt: string | null } | undefined)?.executedAt ?? `${todaySql}T00:00:00Z`

  return {
    id: executionId,
    ruleId: rule.id,
    executionDate: todaySql,
    executedAt,
    weekIndex,
    totalAmount: spentTotal,
    executionDetails,
  }
}

export async function processPortfolioForReinvestment(
  pool: mysql.Pool,
  userId: string,
  now: Date = new Date(),
): Promise<{
  pool: DividendCashPool
  rule: ReinvestmentRule
  nextReinvestmentDate: string | null
  lastExecution: ReinvestmentExecution | null
  accrualsInserted: number
}> {
  const todaySql = toSqlDateUtc(now)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const rule = await getOrCreateRule(conn, userId)
    const accrualsInserted = await accrueDividends(conn, userId, todaySql)
    const lastExecution = await runRuleExecutionIfDue(conn, userId, todaySql, rule)
    const cashPool = await upsertCashPool(conn, userId)

    let nextReinvestmentDate: string | null = null
    if (rule.enabled) {
      if (rule.scheduleMode === 'WEEK_OF_MONTH') {
        nextReinvestmentDate = toSqlDateUtc(addPeriod(parseSqlDate(todaySql), 'weekly'))
      } else {
        const lastExecDate = await getLastExecutionDate(conn, userId, rule.id)
        nextReinvestmentDate = toSqlDateUtc(addPeriod(parseSqlDate(lastExecDate ?? todaySql), rule.frequency))
      }
    }

    await conn.commit()
    return { pool: cashPool, rule, nextReinvestmentDate, lastExecution, accrualsInserted }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function updateReinvestmentRule(
  pool: mysql.Pool,
  userId: string,
  patch: Partial<ReinvestmentRule>,
): Promise<ReinvestmentRule> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const current = await getOrCreateRule(conn, userId)

    const next: ReinvestmentRule = {
      ...current,
      ...patch,
      id: current.id,
    }
    if (next.scheduleMode !== 'FIXED' && next.scheduleMode !== 'WEEK_OF_MONTH') {
      throw new Error('schedule_mode must be FIXED or WEEK_OF_MONTH')
    }

    if (next.sourceScope !== 'ALL' && next.sourceScope !== 'SELECTED') {
      throw new Error('source_scope must be ALL or SELECTED')
    }
    if (
      next.destinationType !== 'SAME_AS_SOURCE' &&
      next.destinationType !== 'SINGLE_ASSET' &&
      next.destinationType !== 'ALLOCATION_BASKET'
    ) {
      throw new Error('destination_type must be SAME_AS_SOURCE, SINGLE_ASSET, or ALLOCATION_BASKET')
    }
    if (next.frequency !== 'weekly' && next.frequency !== 'monthly') {
      if (next.frequency !== 'biweekly') {
        throw new Error('frequency must be weekly, biweekly, or monthly')
      }
    }
    if (!Number.isFinite(next.minimumAmount) || next.minimumAmount < 0) {
      throw new Error('minimum_amount must be >= 0')
    }

    const assets = Array.isArray(next.destinationAssets) ? next.destinationAssets : []

    let weekDestinations: any = null
    if (next.scheduleMode === 'WEEK_OF_MONTH') {
      const wd = next.weekDestinations
      const out: any = {}
      for (const k of [1, 2, 3, 4] as const) {
        const v = wd?.[k]
        if (!v) continue
        const dt = v.destinationType
        const da = Array.isArray(v.destinationAssets) ? v.destinationAssets : []
        if (dt !== 'SAME_AS_SOURCE' && dt !== 'SINGLE_ASSET' && dt !== 'ALLOCATION_BASKET') {
          throw new Error('weekDestinations destinationType invalid')
        }
        out[String(k)] = {
          destinationType: dt,
          destinationAssets: da,
        }
      }
      weekDestinations = Object.keys(out).length ? out : null
    }

    await conn.execute(
      `UPDATE reinvestment_rules
       SET enabled = :enabled,
           source_scope = :sourceScope,
           destination_type = :destinationType,
           destination_assets = :destinationAssets,
           schedule_mode = :scheduleMode,
           frequency = :frequency,
           week_destinations = :weekDestinations,
           minimum_amount = :minimumAmount,
           fractional_shares_allowed = :fractional
       WHERE id = :id AND user_id = :userId`,
      {
        id: current.id,
        userId,
        enabled: next.enabled ? 1 : 0,
        sourceScope: next.sourceScope,
        destinationType: next.destinationType,
        destinationAssets: JSON.stringify(assets),
        scheduleMode: next.scheduleMode,
        frequency: next.frequency,
        weekDestinations: weekDestinations ? JSON.stringify(weekDestinations) : null,
        minimumAmount: next.minimumAmount,
        fractional: next.fractionalSharesAllowed ? 1 : 0,
      },
    )

    await conn.commit()
    return next
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function listReinvestmentExecutions(
  pool: mysql.Pool,
  userId: string,
  limit: number,
): Promise<ReinvestmentExecution[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        id,
        rule_id AS ruleId,
        DATE_FORMAT(execution_date, '%Y-%m-%d') AS executionDate,
        DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS executedAt,
        week_index AS weekIndex,
        total_amount AS totalAmount,
        execution_details AS executionDetails
     FROM reinvestment_executions
     WHERE user_id = :userId
     ORDER BY execution_date DESC, created_at DESC
     LIMIT ${safeLimit}`,
    { userId },
  )

  return (
    rows as unknown as Array<{
      id: string
      ruleId: string
      executionDate: string
      executedAt: string
      weekIndex: number | null
      totalAmount: number
      executionDetails: unknown
    }>
  ).map(
    (r) => {
      let parsed: any = r.executionDetails
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {
          parsed = null
        }
      }
      return {
        id: r.id,
        ruleId: r.ruleId,
        executionDate: r.executionDate,
        executedAt: r.executedAt,
        weekIndex: r.weekIndex === null ? null : Number(r.weekIndex),
        totalAmount: Number(r.totalAmount),
        executionDetails:
          parsed ??
          ({
            sourceScope: 'ALL',
            sourceSymbols: [],
            fractionalSharesAllowed: true,
            details: [],
            leftoverUnspent: 0,
          } satisfies ReinvestmentExecution['executionDetails']),
      }
    },
  )
}
