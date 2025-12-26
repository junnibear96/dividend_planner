import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import UserAuth from '../UserAuth'
import { useAuth } from '../auth'

type Holding = {
  id: string
  symbol: string
  shares: number
  annualDividendPerShare: number
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
  const [shares, setShares] = useState('')
  const [annualDividendPerShare, setAnnualDividendPerShare] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createId = () => {
    const c = globalThis.crypto
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const cleanedSymbol = symbol.trim().toUpperCase()
  const parsedShares = toPositiveNumber(shares)
  const parsedAnnualDividend = toPositiveNumber(annualDividendPerShare)
  const canSubmit = Boolean(
    cleanedSymbol && parsedShares !== null && parsedAnnualDividend !== null,
  )

  const totals = useMemo(() => {
    const annual = holdings.reduce(
      (sum, h) => sum + h.shares * h.annualDividendPerShare,
      0,
    )
    return {
      annual,
      monthly: annual / 12,
    }
  }, [holdings])

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
    if (parsedAnnualDividend === null) {
      setError('Annual dividend/share must be a positive number.')
      return
    }

    setError(null)
    setHoldings((prev) => [
      {
        id: createId(),
        symbol: cleanedSymbol,
        shares: parsedShares,
        annualDividendPerShare: parsedAnnualDividend,
      },
      ...prev,
    ])
    setSymbol('')
    setShares('')
    setAnnualDividendPerShare('')
  }

  function removeHolding(id: string) {
    setHoldings((prev) => prev.filter((h) => h.id !== id))
  }

  return (
    <>
      <div className="summary" aria-label="Estimated totals">
        <div className="summaryCard">
          <div className="summaryKey">Annual</div>
          <div className="summaryValue">{formatMoney(totals.annual)}</div>
        </div>
        <div className="summaryCard">
          <div className="summaryKey">Monthly (avg)</div>
          <div className="summaryValue">{formatMoney(totals.monthly)}</div>
        </div>
      </div>

      <section className="panel">
        <h2>Add holding</h2>
        <form className="form" onSubmit={onAddHolding}>
          <label className="field">
            <span>Symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
              autoComplete="off"
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
            <span>Annual dividend / share (USD)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={annualDividendPerShare}
              onChange={(e) => setAnnualDividendPerShare(e.target.value)}
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
          <p className="hint">Guest mode: your holdings are not saved.</p>
        )}
      </section>

      <section className="panel">
        <h2>Portfolio</h2>
        {holdings.length === 0 ? (
          <p className="empty">No holdings yet.</p>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Shares</th>
                  <th className="num">Annual div/share</th>
                  <th className="num">Annual income</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const annualIncome = h.shares * h.annualDividendPerShare
                  return (
                    <tr key={h.id}>
                      <td className="mono">{h.symbol}</td>
                      <td className="num">{h.shares}</td>
                      <td className="num">{formatMoney(h.annualDividendPerShare)}</td>
                      <td className="num">{formatMoney(annualIncome)}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => removeHolding(h.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="totalsLabel">
                    Total (estimated)
                  </td>
                  <td className="num totalsValue">{formatMoney(totals.annual)}</td>
                  <td />
                </tr>
              </tfoot>
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

  useEffect(() => {
    if (!isAuthLoading && user) {
      navigate('/planner', { replace: true })
    }
  }, [isAuthLoading, user, navigate])

  return (
    <div className="page">
      <div className="pageInner">
        <div className="loginGrid">
          <div className="loginLeft">
            <div className="loginHero">
              <h1>Dividend Planner</h1>
              <p className="subtitle">Plan and estimate dividend income.</p>
            </div>
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

          {!isAuthLoading && !user ? (
            <div className="loginRight">
              <GuestPlanner />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
