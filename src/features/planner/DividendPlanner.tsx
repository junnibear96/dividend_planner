import { useEffect, useMemo, useState } from 'react'
import { searchStockSymbols } from '../stock/stockApi'
import SymbolAutocompleteInput from '../stock/SymbolAutocompleteInput'
import { type DividendFrequency } from '../../utils/dividends'

export type PlannerHolding = {
  id: string
  symbol: string
  shares: number
  dividendPerShare: number
  dividendFrequency: DividendFrequency
  includeInReinvestment?: boolean
  createdAt?: string
}

export type CreateHoldingInput = {
  symbol: string
  shares: number
  dividendPerShare: number
  dividendFrequency: DividendFrequency
  includeInReinvestment?: boolean
}

export type UpdateHoldingInput = {
  shares?: number
  dividendPerShare?: number
  includeInReinvestment?: boolean
}

type Props = {
  mode: 'guest' | 'user'
  showSummary?: boolean
  initialHoldings?: PlannerHolding[]
  canWrite: boolean

  loadHoldings?: () => Promise<PlannerHolding[]>
  createHolding: (input: CreateHoldingInput) => Promise<PlannerHolding>
  updateHolding: (holding: PlannerHolding, input: UpdateHoldingInput) => Promise<PlannerHolding>
  deleteHolding: (id: string) => Promise<void>
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function toPositiveNumber(raw: string): number | null {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function normalizeIncludeFlag(holding: PlannerHolding): boolean {
  return holding.includeInReinvestment !== false
}

export default function DividendPlanner({
  mode,
  showSummary = false,
  initialHoldings,
  canWrite,
  loadHoldings,
  createHolding,
  updateHolding,
  deleteHolding,
}: Props) {
  const [holdings, setHoldings] = useState<PlannerHolding[]>(() => initialHoldings ?? [])

  const [symbol, setSymbol] = useState('')
  const [symbolSuggestions, setSymbolSuggestions] = useState<string[]>([])
  const [shares, setShares] = useState('')
  const [dividendPerShare, setDividendPerShare] = useState('')
  const [dividendFrequency, setDividendFrequency] = useState<DividendFrequency>('yearly')

  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(loadHoldings))
  const [isSaving, setIsSaving] = useState(false)

  const [editHolding, setEditHolding] = useState<PlannerHolding | null>(null)
  const [editShares, setEditShares] = useState('')
  const [editDividendPerShare, setEditDividendPerShare] = useState('')
  const [isEditSaving, setIsEditSaving] = useState(false)

  const cleanedSymbol = symbol.trim().toUpperCase()
  const parsedShares = toPositiveNumber(shares)
  const parsedDividendPerShare = toPositiveNumber(dividendPerShare)
  const canSubmit = Boolean(
    canWrite &&
      !isSaving &&
      cleanedSymbol &&
      parsedShares !== null &&
      parsedDividendPerShare !== null,
  )

  const weeklyHoldings = useMemo(
    () => holdings.filter((h) => h.dividendFrequency === 'weekly'),
    [holdings],
  )
  const monthlyHoldings = useMemo(
    () => holdings.filter((h) => h.dividendFrequency === 'monthly'),
    [holdings],
  )
  const yearlyHoldings = useMemo(
    () => holdings.filter((h) => h.dividendFrequency === 'yearly'),
    [holdings],
  )

  const frequencyTotals = useMemo(() => {
    const weekly = weeklyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    const monthly = monthlyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    const yearly = yearlyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    return { weekly, monthly, yearly }
  }, [weeklyHoldings, monthlyHoldings, yearlyHoldings])

  const annualizedTotals = useMemo(() => {
    const annualWeekly = frequencyTotals.weekly * 4 * 12
    const annualMonthly = frequencyTotals.monthly * 12
    const annualYearly = frequencyTotals.yearly
    const total = annualWeekly + annualMonthly + annualYearly
    return { annualWeekly, annualMonthly, annualYearly, total }
  }, [frequencyTotals])

  const totals = useMemo(() => {
    const yearly = annualizedTotals.total
    const monthly = yearly / 12
    const weekly = yearly / (4 * 12)
    return { weekly, monthly, yearly }
  }, [annualizedTotals])

  const reinvestCandidates = useMemo(() => {
    function topSymbols(list: PlannerHolding[]) {
      return [...list]
        .map((h) => ({ symbol: h.symbol, income: h.shares * h.dividendPerShare }))
        .sort((a, b) => b.income - a.income)
        .filter((r) => Number.isFinite(r.income) && r.income > 0)
        .slice(0, 3)
        .map((r) => r.symbol)
    }

    return {
      weekly: topSymbols(weeklyHoldings),
      monthly: topSymbols(monthlyHoldings),
      yearly: topSymbols(yearlyHoldings),
    }
  }, [weeklyHoldings, monthlyHoldings, yearlyHoldings])

  const parsedEditShares = toPositiveNumber(editShares)
  const parsedEditDividendPerShare = toPositiveNumber(editDividendPerShare)
  const canSaveEdit = Boolean(
    canWrite &&
      editHolding &&
      !isEditSaving &&
      parsedEditShares !== null &&
      parsedEditDividendPerShare !== null,
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!loadHoldings) return
      try {
        setIsLoading(true)
        setError(null)
        const next = await loadHoldings()
        if (!cancelled) setHoldings(Array.isArray(next) ? next : [])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load holdings')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [loadHoldings])

  useEffect(() => {
    const q = symbol.trim()
    if (!q) {
      setSymbolSuggestions([])
      return
    }

    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void searchStockSymbols(q, 10, controller.signal)
        .then(setSymbolSuggestions)
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSymbolSuggestions([])
        })
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [symbol])

  function openEdit(h: PlannerHolding) {
    setError(null)
    setEditHolding(h)
    setEditShares(String(h.shares))
    setEditDividendPerShare(String(h.dividendPerShare))
  }

  function closeEdit() {
    if (isEditSaving) return
    setEditHolding(null)
    setEditShares('')
    setEditDividendPerShare('')
  }

  function onEditOverlayMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) closeEdit()
  }

  function onEditKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') closeEdit()
  }

  function onAddHolding(e: React.FormEvent) {
    e.preventDefault()

    if (!canWrite) {
      setError(mode === 'user' ? 'Please log in to add holdings.' : 'Cannot add holdings.')
      return
    }
    if (!cleanedSymbol) {
      setError('Symbol is required.')
      return
    }
    if (parsedShares === null) {
      setError('Shares must be a positive number.')
      return
    }
    if (parsedDividendPerShare === null) {
      setError('Dividend/share must be a positive number.')
      return
    }

    const sharesValue = parsedShares
    const dividendPerShareValue = parsedDividendPerShare
    if (sharesValue === null || dividendPerShareValue === null) {
      setError('Invalid number input.')
      return
    }

    async function save() {
      try {
        setIsSaving(true)
        setError(null)
        const holding = await createHolding({
          symbol: cleanedSymbol,
          shares: sharesValue,
          dividendPerShare: dividendPerShareValue,
          dividendFrequency,
          includeInReinvestment: true,
        })

        setHoldings((prev) => [holding, ...prev])
        setSymbol('')
        setShares('')
        setDividendPerShare('')
        setDividendFrequency('yearly')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save holding')
      } finally {
        setIsSaving(false)
      }
    }

    void save()
  }

  function removeHolding(id: string) {
    async function remove() {
      if (!canWrite) {
        setError(mode === 'user' ? 'Please log in to remove holdings.' : 'Cannot remove holdings.')
        return
      }

      let previousHoldings: PlannerHolding[] | null = null
      setHoldings((prev) => {
        previousHoldings = prev
        return prev.filter((h) => h.id !== id)
      })

      try {
        setError(null)
        await deleteHolding(id)
      } catch (err) {
        if (previousHoldings) setHoldings(previousHoldings)
        setError(err instanceof Error ? err.message : 'Failed to delete holding')
      }
    }

    void remove()
  }

  async function toggleIncludeInReinvestment(holding: PlannerHolding, next: boolean) {
    if (!canWrite) {
      setError(mode === 'user' ? 'Please log in to edit holdings.' : 'Cannot edit holdings.')
      return
    }

    let previousHoldings: PlannerHolding[] | null = null
    setHoldings((prev) => {
      previousHoldings = prev
      return prev.map((h) => (h.id === holding.id ? { ...h, includeInReinvestment: next } : h))
    })

    try {
      setError(null)
      const updated = await updateHolding(holding, { includeInReinvestment: next })
      setHoldings((prev) => prev.map((h) => (h.id === updated.id ? updated : h)))
    } catch (err) {
      if (previousHoldings) setHoldings(previousHoldings)
      setError(err instanceof Error ? err.message : 'Failed to update holding')
    }
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()

    if (!canWrite) {
      setError(mode === 'user' ? 'Please log in to edit holdings.' : 'Cannot edit holdings.')
      return
    }
    if (!editHolding) return
    if (parsedEditShares === null) {
      setError('Shares must be a positive number.')
      return
    }
    if (parsedEditDividendPerShare === null) {
      setError('Dividend/share must be a positive number.')
      return
    }

    const current = editHolding
    const sharesValue = parsedEditShares
    const dividendPerShareValue = parsedEditDividendPerShare
    if (sharesValue === null || dividendPerShareValue === null) {
      setError('Invalid number input.')
      return
    }

    async function save() {
      try {
        setIsEditSaving(true)
        setError(null)
        const updated = await updateHolding(current, {
          shares: sharesValue,
          dividendPerShare: dividendPerShareValue,
        })

        setHoldings((prev) => prev.map((h) => (h.id === updated.id ? updated : h)))
        closeEdit()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update holding')
      } finally {
        setIsEditSaving(false)
      }
    }

    void save()
  }

  return (
    <>
      {editHolding ? (
        <div
          className="modalOverlay"
          role="presentation"
          onMouseDown={onEditOverlayMouseDown}
          onKeyDown={onEditKeyDown}
        >
          <div className="modalDialog" role="dialog" aria-modal="true" aria-label="Edit holding">
            <div className="modalHeader">
              <div className="modalTitle">Edit holding ({editHolding.symbol})</div>
              <button
                type="button"
                className="modalClose"
                onClick={closeEdit}
                disabled={isEditSaving}
              >
                Close
              </button>
            </div>

            <form className="form" onSubmit={onSaveEdit}>
              <label className="field">
                <span>Shares</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editShares}
                  onChange={(ev) => setEditShares(ev.target.value)}
                  inputMode="decimal"
                  placeholder="10"
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Dividend / share (USD)</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editDividendPerShare}
                  onChange={(ev) => setEditDividendPerShare(ev.target.value)}
                  inputMode="decimal"
                  placeholder="1.00"
                />
              </label>
              <div className="actions">
                <button type="submit" disabled={!canSaveEdit}>
                  Save changes
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showSummary ? (
        <div className="summary" aria-label="Estimated totals">
          <div className="summaryCard">
            <div className="summaryKey">Yearly</div>
            <div className="summaryValue">{formatMoney(totals.yearly)}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">Monthly</div>
            <div className="summaryValue">{formatMoney(totals.monthly)}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">Weekly</div>
            <div className="summaryValue">{formatMoney(totals.weekly)}</div>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <h2>Add holding</h2>
        <form className="form" onSubmit={onAddHolding}>
          <label className="field">
            <span>Symbol</span>
            <SymbolAutocompleteInput
              value={symbol}
              onValueChange={setSymbol}
              suggestions={symbolSuggestions}
              placeholder="AAPL"
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <label className="field">
            <span>Shares</span>
            <input
              type="number"
              min={0}
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              inputMode="decimal"
              placeholder="10"
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <label className="field">
            <div className="fieldLabelRow">
              <span>Dividend / share (USD)</span>
              <select
                value={dividendFrequency}
                onChange={(e) => setDividendFrequency(e.target.value as DividendFrequency)}
                aria-label="Dividend frequency"
                disabled={!canWrite && mode === 'user'}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <input
              type="number"
              min={0}
              step="any"
              value={dividendPerShare}
              onChange={(e) => setDividendPerShare(e.target.value)}
              inputMode="decimal"
              placeholder="1.00"
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={!canSubmit}>
              Add holding
            </button>
          </div>
        </form>

        {error ? (
          <p className="error" role="alert" aria-live="polite">
            {error}
          </p>
        ) : (
          <p className="hint">Tip: enter dividend per share for the selected frequency in USD.</p>
        )}
      </section>

      <section className="panel">
        <h2>Weekly dividend income</h2>
        {isLoading ? (
          <p className="empty">Loading…</p>
        ) : weeklyHoldings.length === 0 ? (
          <p className="empty">No weekly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates: {reinvestCandidates.weekly.length ? reinvestCandidates.weekly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Weekly income</th>
                    <th className="num">Include in reinvestment</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {weeklyHoldings.map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{h.symbol}</td>
                      <td className="num">{h.shares}</td>
                      <td className="num">{formatMoney(h.dividendPerShare)}</td>
                      <td className="num">{formatMoney(h.shares * h.dividendPerShare)}</td>
                      <td className="num">
                        <input
                          type="checkbox"
                          checked={normalizeIncludeFlag(h)}
                          onChange={(e) => void toggleIncludeInReinvestment(h, e.target.checked)}
                          disabled={!canWrite}
                          aria-label={`Include ${h.symbol} in reinvestment`}
                        />
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => openEdit(h)}
                          disabled={!canWrite}
                        >
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      Total (weekly holdings)
                    </td>
                    <td className="num totalsValue">{formatMoney(frequencyTotals.weekly)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Monthly dividend income</h2>
        {isLoading ? (
          <p className="empty">Loading…</p>
        ) : monthlyHoldings.length === 0 ? (
          <p className="empty">No monthly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates: {reinvestCandidates.monthly.length ? reinvestCandidates.monthly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Monthly income</th>
                    <th className="num">Include in reinvestment</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {monthlyHoldings.map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{h.symbol}</td>
                      <td className="num">{h.shares}</td>
                      <td className="num">{formatMoney(h.dividendPerShare)}</td>
                      <td className="num">{formatMoney(h.shares * h.dividendPerShare)}</td>
                      <td className="num">
                        <input
                          type="checkbox"
                          checked={normalizeIncludeFlag(h)}
                          onChange={(e) => void toggleIncludeInReinvestment(h, e.target.checked)}
                          disabled={!canWrite}
                          aria-label={`Include ${h.symbol} in reinvestment`}
                        />
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => openEdit(h)}
                          disabled={!canWrite}
                        >
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      Total (monthly holdings)
                    </td>
                    <td className="num totalsValue">{formatMoney(frequencyTotals.monthly)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Yearly dividend income</h2>
        {isLoading ? (
          <p className="empty">Loading…</p>
        ) : yearlyHoldings.length === 0 ? (
          <p className="empty">No yearly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates: {reinvestCandidates.yearly.length ? reinvestCandidates.yearly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Yearly income</th>
                    <th className="num">Include in reinvestment</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {yearlyHoldings.map((h) => (
                    <tr key={h.id}>
                      <td className="mono">{h.symbol}</td>
                      <td className="num">{h.shares}</td>
                      <td className="num">{formatMoney(h.dividendPerShare)}</td>
                      <td className="num">{formatMoney(h.shares * h.dividendPerShare)}</td>
                      <td className="num">
                        <input
                          type="checkbox"
                          checked={normalizeIncludeFlag(h)}
                          onChange={(e) => void toggleIncludeInReinvestment(h, e.target.checked)}
                          disabled={!canWrite}
                          aria-label={`Include ${h.symbol} in reinvestment`}
                        />
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => openEdit(h)}
                          disabled={!canWrite}
                        >
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      Total (yearly holdings)
                    </td>
                    <td className="num totalsValue">{formatMoney(frequencyTotals.yearly)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Total dividend (annualized estimate)</h2>
        {isLoading ? (
          <p className="empty">Loading…</p>
        ) : holdings.length === 0 ? (
          <p className="empty">No holdings yet.</p>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Weekly total</th>
                  <th className="num">Monthly total</th>
                  <th className="num">Yearly total</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num">{formatMoney(annualizedTotals.annualWeekly)}</td>
                  <td className="num">{formatMoney(annualizedTotals.annualMonthly)}</td>
                  <td className="num">{formatMoney(annualizedTotals.annualYearly)}</td>
                  <td className="num">{formatMoney(annualizedTotals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
