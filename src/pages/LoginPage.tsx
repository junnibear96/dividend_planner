import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import UserAuth from '../UserAuth'
import { useAuth } from '../auth'
import { searchStockSymbols } from '../features/stock/stockApi'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import { type DividendFrequency } from '../utils/dividends'

type Holding = {
  id: string
  symbol: string
  shares: number
  dividendPerShare: number
  dividendFrequency: DividendFrequency
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

function GuestPlanner() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [symbol, setSymbol] = useState('')
  const [symbolSuggestions, setSymbolSuggestions] = useState<string[]>([])
  const [shares, setShares] = useState('')
  const [dividendPerShare, setDividendPerShare] = useState('')
  const [dividendFrequency, setDividendFrequency] = useState<DividendFrequency>('yearly')
  const [error, setError] = useState<string | null>(null)

  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const [editShares, setEditShares] = useState('')
  const [editDividendPerShare, setEditDividendPerShare] = useState('')

  const createId = () => {
    const c = globalThis.crypto
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const cleanedSymbol = symbol.trim().toUpperCase()
  const parsedShares = toPositiveNumber(shares)
  const parsedDividendPerShare = toPositiveNumber(dividendPerShare)
  const canSubmit = Boolean(cleanedSymbol && parsedShares !== null && parsedDividendPerShare !== null)

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
    function topSymbols(list: Holding[]) {
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

  function onAddHolding(e: React.FormEvent) {
    e.preventDefault()

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

    setError(null)
    setHoldings((prev) => [
      {
        id: createId(),
        symbol: cleanedSymbol,
        shares: parsedShares,
        dividendPerShare: parsedDividendPerShare,
        dividendFrequency,
      },
      ...prev,
    ])
    setSymbol('')
    setShares('')
    setDividendPerShare('')
    setDividendFrequency('yearly')
  }

  function removeHolding(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id))
  }

  function openEdit(h: Holding) {
    setError(null)
    setEditHolding(h)
    setEditShares(String(h.shares))
    setEditDividendPerShare(String(h.dividendPerShare))
  }

  function closeEdit() {
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

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editHolding) return

    const nextShares = toPositiveNumber(editShares)
    if (nextShares === null) {
      setError('Shares must be a positive number.')
      return
    }
    const nextDividend = toPositiveNumber(editDividendPerShare)
    if (nextDividend === null) {
      setError('Dividend/share must be a positive number.')
      return
    }

    setHoldings((prev) =>
      prev.map((h) =>
        h.id === editHolding.id ? { ...h, shares: nextShares, dividendPerShare: nextDividend } : h,
      ),
    )
    closeEdit()
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
              <button type="button" className="modalClose" onClick={closeEdit}>
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
                <button type="submit">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

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
            />
          </label>
          <label className="field">
            <div className="fieldLabelRow">
              <span>Dividend / share (USD)</span>
              <select
                value={dividendFrequency}
                onChange={(e) => setDividendFrequency(e.target.value as DividendFrequency)}
                aria-label="Dividend frequency"
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
        {weeklyHoldings.length === 0 ? (
          <p className="empty">No weekly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates:{' '}
              {reinvestCandidates.weekly.length ? reinvestCandidates.weekly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Weekly income</th>
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
                        <button type="button" className="linkButton" onClick={() => openEdit(h)}>
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button type="button" className="linkButton" onClick={() => removeHolding(h.id)}>
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
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Monthly dividend income</h2>
        {monthlyHoldings.length === 0 ? (
          <p className="empty">No monthly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates:{' '}
              {reinvestCandidates.monthly.length ? reinvestCandidates.monthly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Monthly income</th>
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
                        <button type="button" className="linkButton" onClick={() => openEdit(h)}>
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button type="button" className="linkButton" onClick={() => removeHolding(h.id)}>
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
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Yearly dividend income</h2>
        {yearlyHoldings.length === 0 ? (
          <p className="empty">No yearly dividend holdings.</p>
        ) : (
          <>
            <p className="hint">
              Reinvest candidates:{' '}
              {reinvestCandidates.yearly.length ? reinvestCandidates.yearly.join(', ') : '—'}
            </p>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Dividend / share</th>
                    <th className="num">Yearly income</th>
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
                        <button type="button" className="linkButton" onClick={() => openEdit(h)}>
                          Edit
                        </button>
                        <span aria-hidden="true">&nbsp;&nbsp;</span>
                        <button type="button" className="linkButton" onClick={() => removeHolding(h.id)}>
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
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Total dividend (annualized estimate)</h2>
        {holdings.length === 0 ? (
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

export default function LoginPage() {
  const { user, isAuthLoading, setUser } = useAuth()
  const navigate = useNavigate()
  const [stockSearch, setStockSearch] = useState('')
  const [isWide, setIsWide] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 900px)').matches
  })
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  useEffect(() => {
    if (!isAuthLoading && user) {
      navigate('/planner', { replace: true })
    }
  }, [isAuthLoading, user, navigate])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const onChange = () => setIsWide(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (isWide && isAuthModalOpen) setIsAuthModalOpen(false)
  }, [isWide, isAuthModalOpen])

  useEffect(() => {
    if (!isAuthModalOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAuthModalOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAuthModalOpen])

  function onStockSearch(e: React.FormEvent) {
    e.preventDefault()
    const raw = stockSearch.trim()
    if (!raw) return
    const nextSymbol = raw.toUpperCase()
    const url = `/stock?symbol=${encodeURIComponent(nextSymbol)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="page">
      <div className="pageInner">
        <div className="loginGrid">
          <div className="loginHero">
            {!isWide && !isAuthLoading && !user ? (
              <button
                type="button"
                className="loginJumpButton"
                onClick={() => {
                  setIsAuthModalOpen(true)
                }}
              >
                Log in
              </button>
            ) : null}
            <h1>Dividend Planner</h1>
            <p className="subtitle">Plan and estimate dividend income.</p>

            <form className="stockSearch" onSubmit={onStockSearch} role="search">
              <input
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder="Search symbol (e.g., TSLY.US)"
                autoComplete="off"
              />
              <button type="submit" disabled={!stockSearch.trim()}>
                Search
              </button>
            </form>
          </div>

          {!isAuthLoading && !user ? (
            <div className="loginRight">
              <GuestPlanner />
            </div>
          ) : null}

          {isWide ? (
            <div className="loginLeft">
              <div className="loginCard">
                <UserAuth
                  user={user}
                  onUserChange={(next) => {
                    setUser(next)
                    if (next) navigate('/planner', { replace: true })
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {!isWide && !isAuthLoading && !user && isAuthModalOpen ? (
          <div
            className="modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label="Account"
            onMouseDown={() => setIsAuthModalOpen(false)}
          >
            <div className="modalDialog" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modalHeader">
                <div className="modalTitle">Account</div>
                <button
                  type="button"
                  className="modalClose"
                  aria-label="Close"
                  onClick={() => setIsAuthModalOpen(false)}
                >
                  ×
                </button>
              </div>
              <UserAuth
                user={user}
                onUserChange={(next) => {
                  setUser(next)
                  if (next) {
                    setIsAuthModalOpen(false)
                    navigate('/planner', { replace: true })
                  }
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
