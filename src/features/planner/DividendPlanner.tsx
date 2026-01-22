import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
  const quarterlyHoldings = useMemo(
    () => holdings.filter((h) => h.dividendFrequency === 'quarterly'),
    [holdings],
  )
  const yearlyHoldings = useMemo(
    () => holdings.filter((h) => h.dividendFrequency === 'yearly'),
    [holdings],
  )

  const frequencyTotals = useMemo(() => {
    const weekly = weeklyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    const monthly = monthlyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    const quarterly = quarterlyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    const yearly = yearlyHoldings.reduce((sum, h) => sum + h.shares * h.dividendPerShare, 0)
    return { weekly, monthly, quarterly, yearly }
  }, [weeklyHoldings, monthlyHoldings, quarterlyHoldings, yearlyHoldings])

  const annualizedTotals = useMemo(() => {
    const annualWeekly = frequencyTotals.weekly * 4 * 12
    const annualMonthly = frequencyTotals.monthly * 12
    const annualQuarterly = frequencyTotals.quarterly * 4
    const annualYearly = frequencyTotals.yearly
    const total = annualWeekly + annualMonthly + annualQuarterly + annualYearly
    return { annualWeekly, annualMonthly, annualQuarterly, annualYearly, total }
  }, [frequencyTotals])

  const totals = useMemo(() => {
    const yearly = annualizedTotals.total
    const quarterly = yearly / 4
    const monthly = yearly / 12
    const weekly = yearly / (4 * 12)
    return { weekly, monthly, quarterly, yearly }
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
      quarterly: topSymbols(quarterlyHoldings),
      yearly: topSymbols(yearlyHoldings),
    }
  }, [weeklyHoldings, monthlyHoldings, quarterlyHoldings, yearlyHoldings])

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
          setError(err instanceof Error ? err.message : t('planner.errors.loadFailed'))
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
      setError(mode === 'user' ? t('planner.errors.loginToAdd') : t('planner.errors.cannotAdd'))
      return
    }
    if (!cleanedSymbol) {
      setError(t('planner.errors.symbolRequired'))
      return
    }
    if (parsedShares === null) {
      setError(t('planner.errors.sharesPositive'))
      return
    }
    if (parsedDividendPerShare === null) {
      setError(t('planner.errors.dividendPositive'))
      return
    }

    const sharesValue = parsedShares
    const dividendPerShareValue = parsedDividendPerShare
    if (sharesValue === null || dividendPerShareValue === null) {
      setError(t('planner.errors.invalidNumber'))
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
        setError(err instanceof Error ? err.message : t('planner.errors.saveFailed'))
      } finally {
        setIsSaving(false)
      }
    }

    void save()
  }

  function removeHolding(id: string) {
    async function remove() {
      if (!canWrite) {
        setError(mode === 'user' ? t('planner.errors.loginToRemove') : t('planner.errors.cannotRemove'))
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
        setError(err instanceof Error ? err.message : t('planner.errors.deleteFailed'))
      }
    }

    void remove()
  }

  async function toggleIncludeInReinvestment(holding: PlannerHolding, next: boolean) {
    if (!canWrite) {
      setError(mode === 'user' ? t('planner.errors.loginToEdit') : t('planner.errors.cannotEdit'))
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
      setError(err instanceof Error ? err.message : t('planner.errors.updateFailed'))
    }
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()

    if (!canWrite) {
      setError(mode === 'user' ? t('planner.errors.loginToEdit') : t('planner.errors.cannotEdit'))
      return
    }
    if (!editHolding) return
    if (parsedEditShares === null) {
      setError(t('planner.errors.sharesPositive'))
      return
    }
    if (parsedEditDividendPerShare === null) {
      setError(t('planner.errors.dividendPositive'))
      return
    }

    const current = editHolding
    const sharesValue = parsedEditShares
    const dividendPerShareValue = parsedEditDividendPerShare
    if (sharesValue === null || dividendPerShareValue === null) {
      setError(t('planner.errors.invalidNumber'))
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
        setError(err instanceof Error ? err.message : t('planner.errors.updateFailed'))
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
          <div className="modalDialog" role="dialog" aria-modal="true" aria-label={t('planner.holdingModal.title')}>
            <div className="modalHeader">
              <div className="modalTitle">{t('planner.holdingModal.title')} ({editHolding.symbol})</div>
              <button
                type="button"
                className="modalClose"
                onClick={closeEdit}
                disabled={isEditSaving}
              >
                {t('planner.holdingModal.close')}
              </button>
            </div>

            <form className="form" onSubmit={onSaveEdit}>
              <label className="field">
                <span>{t('planner.holdingModal.shares')}</span>
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
                <span>{t('planner.holdingModal.dividendPerShare')}</span>
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
                  {t('planner.holdingModal.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showSummary ? (
        <div className="summary" aria-label={t('planner.summary.title')}>
          <div className="summaryCard">
            <div className="summaryKey">{t('planner.summary.yearly')}</div>
            <div className="summaryValue">{formatMoney(totals.yearly)}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">{t('planner.summary.quarterly')}</div>
            <div className="summaryValue">{formatMoney(totals.quarterly)}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">{t('planner.summary.monthly')}</div>
            <div className="summaryValue">{formatMoney(totals.monthly)}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">{t('planner.summary.weekly')}</div>
            <div className="summaryValue">{formatMoney(totals.weekly)}</div>
          </div>
        </div >
      ) : null
      }

      <section className="panel">
        <h2>{t('planner.add.title')}</h2>
        <form className="form" onSubmit={onAddHolding}>
          <label className="field">
            <span>{t('planner.add.symbolLabel')}</span>
            <SymbolAutocompleteInput
              value={symbol}
              onValueChange={setSymbol}
              suggestions={symbolSuggestions}
              placeholder={t('planner.add.symbolPlaceholder')}
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <label className="field">
            <span>{t('planner.add.sharesLabel')}</span>
            <input
              type="number"
              min={0}
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              inputMode="decimal"
              placeholder={t('planner.add.sharesPlaceholder')}
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <label className="field">
            <div className="fieldLabelRow">
              <span>{t('planner.add.dividendLabel')}</span>
              <select
                value={dividendFrequency}
                onChange={(e) => setDividendFrequency(e.target.value as DividendFrequency)}
                aria-label="Dividend frequency"
                disabled={!canWrite && mode === 'user'}
              >
                <option value="weekly">{t('planner.add.frequency.weekly')}</option>
                <option value="monthly">{t('planner.add.frequency.monthly')}</option>
                <option value="weekly">{t('planner.add.frequency.weekly')}</option>
                <option value="monthly">{t('planner.add.frequency.monthly')}</option>
                <option value="quarterly">{t('planner.add.frequency.quarterly')}</option>
                <option value="yearly">{t('planner.add.frequency.yearly')}</option>
              </select>
            </div>
            <input
              type="number"
              min={0}
              step="any"
              value={dividendPerShare}
              onChange={(e) => setDividendPerShare(e.target.value)}
              inputMode="decimal"
              placeholder={t('planner.add.dividendPlaceholder')}
              disabled={!canWrite && mode === 'user'}
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={!canSubmit}>
              {t('planner.add.submit')}
            </button>
          </div>
        </form>

        {error ? (
          <p className="error" role="alert" aria-live="polite">
            {error}
          </p>
        ) : (
          <p className="hint">{t('planner.add.tip')}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t('planner.sections.weeklyTitle')}</h2>
        {isLoading ? (
          <p className="empty">{t('planner.table.loading')}</p>
        ) : weeklyHoldings.length === 0 ? (
          <p className="empty">{t('planner.table.emptyWeekly')}</p>
        ) : (
          <>
            <p className="hint">
              {t('planner.table.reinvestCandidates')}: {reinvestCandidates.weekly.length ? reinvestCandidates.weekly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('planner.table.symbol')}</th>
                    <th className="num">{t('planner.table.shares')}</th>
                    <th className="num">{t('planner.table.dividendPerShare')}</th>
                    <th className="num">{t('planner.table.income')}</th>
                    <th className="num">{t('planner.table.includeInReinvestment')}</th>
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
                          {t('planner.table.edit')}
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          {t('planner.table.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      {t('planner.table.totalLabel')}
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
        <h2>{t('planner.sections.monthlyTitle')}</h2>
        {isLoading ? (
          <p className="empty">{t('planner.table.loading')}</p>
        ) : monthlyHoldings.length === 0 ? (
          <p className="empty">{t('planner.table.emptyMonthly')}</p>
        ) : (
          <>
            <p className="hint">
              {t('planner.table.reinvestCandidates')}: {reinvestCandidates.monthly.length ? reinvestCandidates.monthly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('planner.table.symbol')}</th>
                    <th className="num">{t('planner.table.shares')}</th>
                    <th className="num">{t('planner.table.dividendPerShare')}</th>
                    <th className="num">{t('planner.table.income')}</th>
                    <th className="num">{t('planner.table.includeInReinvestment')}</th>
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
                          {t('planner.table.edit')}
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          {t('planner.table.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      {t('planner.table.totalLabel')}
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
        <h2>{t('planner.sections.quarterlyTitle')}</h2>
        {isLoading ? (
          <p className="empty">{t('planner.table.loading')}</p>
        ) : quarterlyHoldings.length === 0 ? (
          <p className="empty">{t('planner.table.emptyQuarterly')}</p>
        ) : (
          <>
            <p className="hint">
              {t('planner.table.reinvestCandidates')}: {reinvestCandidates.quarterly.length ? reinvestCandidates.quarterly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('planner.table.symbol')}</th>
                    <th className="num">{t('planner.table.shares')}</th>
                    <th className="num">{t('planner.table.dividendPerShare')}</th>
                    <th className="num">{t('planner.table.income')}</th>
                    <th className="num">{t('planner.table.includeInReinvestment')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quarterlyHoldings.map((h) => (
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
                          {t('planner.table.edit')}
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          {t('planner.table.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      {t('planner.table.totalLabel')}
                    </td>
                    <td className="num totalsValue">{formatMoney(frequencyTotals.quarterly)}</td>
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
        <h2>{t('planner.sections.yearlyTitle')}</h2>
        {isLoading ? (
          <p className="empty">{t('planner.table.loading')}</p>
        ) : yearlyHoldings.length === 0 ? (
          <p className="empty">{t('planner.table.emptyYearly')}</p>
        ) : (
          <>
            <p className="hint">
              {t('planner.table.reinvestCandidates')}: {reinvestCandidates.yearly.length ? reinvestCandidates.yearly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('planner.table.symbol')}</th>
                    <th className="num">{t('planner.table.shares')}</th>
                    <th className="num">{t('planner.table.dividendPerShare')}</th>
                    <th className="num">{t('planner.table.income')}</th>
                    <th className="num">{t('planner.table.includeInReinvestment')}</th>
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
                          {t('planner.table.edit')}
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                          disabled={!canWrite}
                        >
                          {t('planner.table.remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="totalsLabel">
                      {t('planner.table.totalLabel')}
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
        <h2>{t('planner.sections.totalTitle')}</h2>
        {isLoading ? (
          <p className="empty">{t('planner.table.loading')}</p>
        ) : holdings.length === 0 ? (
          <p className="empty">{t('planner.table.empty')}</p>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">{t('planner.annualizedTable.weeklyTotal')}</th>
                  <th className="num">{t('planner.annualizedTable.monthlyTotal')}</th>
                  <th className="num">{t('planner.annualizedTable.quarterlyTotal')}</th>
                  <th className="num">{t('planner.annualizedTable.yearlyTotal')}</th>
                  <th className="num">{t('planner.annualizedTable.total')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num">{formatMoney(annualizedTotals.annualWeekly)}</td>
                  <td className="num">{formatMoney(annualizedTotals.annualMonthly)}</td>
                  <td className="num">{formatMoney(annualizedTotals.annualQuarterly)}</td>
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
