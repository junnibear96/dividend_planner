
import * as mysql from 'mysql2/promise'
import { randomUUID } from 'crypto'

export type CollectionPlanFrequency = 'daily' | 'weekly' | 'monthly'
export type CollectionPlanStatus = 'ACTIVE' | 'PAUSED'
export type InvestmentType = 'AMOUNT' | 'QUANTITY'
export type Currency = 'USD' | 'KRW'

export interface CollectionPlan {
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

export async function createCollectionPlan(
    conn: mysql.PoolConnection,
    userId: string,
    data: {
        targetStock: string
        frequency: CollectionPlanFrequency
        investmentType: InvestmentType
        currency: Currency
        amount: number
        autoDeposit: boolean
        startDate: string
    }
): Promise<CollectionPlan> {
    const symbol = data.targetStock.trim().toUpperCase()

    if (!symbol) throw new Error('Target stock symbol is required')
    if (data.amount <= 0) throw new Error('Amount must be greater than 0')

    const [result] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO collection_plans (
      user_id, target_stock, frequency, investment_type, currency, amount, auto_deposit, start_date, status
    ) VALUES (
      :userId, :targetStock, :frequency, :investmentType, :currency, :amount, :autoDeposit, :startDate, 'ACTIVE'
    )`,
        {
            userId,
            targetStock: symbol,
            frequency: data.frequency,
            investmentType: data.investmentType,
            currency: data.currency,
            amount: data.amount,
            autoDeposit: data.autoDeposit,
            startDate: data.startDate
        }
    )

    const id = result.insertId

    return {
        id,
        userId,
        targetStock: symbol,
        frequency: data.frequency,
        investmentType: data.investmentType,
        currency: data.currency,
        amount: data.amount,
        autoDeposit: data.autoDeposit,
        startDate: data.startDate,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
    }
}

export async function listCollectionPlans(
    conn: mysql.PoolConnection,
    userId: string
): Promise<CollectionPlan[]> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT * FROM collection_plans WHERE user_id = :userId ORDER BY created_at DESC`,
        { userId }
    )

    return (rows as any[]).map(row => ({
        id: row.id,
        userId: row.user_id,
        targetStock: row.target_stock,
        frequency: row.frequency,
        investmentType: row.investment_type,
        currency: row.currency,
        amount: Number(row.amount),
        autoDeposit: Boolean(row.auto_deposit),
        startDate: row.start_date instanceof Date ? row.start_date.toISOString().split('T')[0] : row.start_date,
        status: row.status,
        createdAt: row.created_at
    }))
}

export async function updateCollectionPlan(
    conn: mysql.PoolConnection,
    userId: string,
    planId: string,
    updates: Partial<Pick<CollectionPlan, 'amount' | 'status' | 'frequency'>>
): Promise<void> {
    const fields: string[] = []
    const params: Record<string, any> = { userId, planId }

    if (updates.amount !== undefined) {
        fields.push('amount = :amount')
        params.amount = updates.amount
    }
    if (updates.status !== undefined) {
        fields.push('status = :status')
        params.status = updates.status
    }
    if (updates.frequency !== undefined) {
        fields.push('frequency = :frequency')
        params.frequency = updates.frequency
    }

    if (fields.length === 0) return

    await conn.execute(
        `UPDATE collection_plans 
     SET ${fields.join(', ')} 
     WHERE id = :planId AND user_id = :userId`,
        params
    )
}

export async function deleteCollectionPlan(
    conn: mysql.PoolConnection,
    userId: string,
    planId: string
): Promise<void> {
    await conn.execute(
        `DELETE FROM collection_plans WHERE id = :planId AND user_id = :userId`,
        { userId, planId }
    )
}

// NOTE: processCollectionPlans (Simulation Logic) will be implemented here later
// or in a separate simulation service. For now, the frontend needs CRUD.
