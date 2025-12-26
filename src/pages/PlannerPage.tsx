import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

type Holding = {
  id: string
  symbol: string
  shares: number
  annualDividendPerShare: number
  createdAt?: string
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

async function jsonOrNull(res: Response) {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export default function PlannerPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const [holdings, setHoldings] = useState<Holding[]>([])
  const [symbol, setSymbol] = useState('')
  const [shares, setShares] = useState('')
  const [annualDividendPerShare, setAnnualDividendPerShare] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const cleanedSymbol = symbol.trim().toUpperCase()
  const parsedShares = toPositiveNumber(shares)
  const parsedAnnualDividend = toPositiveNumber(annualDividendPerShare)
  const canSubmit = Boolean(
    user &&
      !isSaving &&
      cleanedSymbol &&
      parsedShares !== null &&
      parsedAnnualDividend !== null,
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

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setIsLoading(true)
        setError(null)
        const res = await fetch('/api/holdings')
        if (!res.ok) {
          const body = (await jsonOrNull(res)) as { error?: string } | null
          throw new Error(body?.error ?? `Failed to load holdings (${res.status})`)
        }
        const data = (await res.json()) as { holdings: Holding[] }
        if (!cancelled) setHoldings(Array.isArray(data.holdings) ? data.holdings : [])
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
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    navigate('/login', { replace: true })
  }

  function onAddHolding(e: React.FormEvent) {
    e.preventDefault()

    if (!user) {
      setError('Please log in to add holdings.')
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
    if (parsedAnnualDividend === null) {
      setError('Annual dividend/share must be a positive number.')
      return
    }

    async function save() {
      try {
        setIsSaving(true)
        setError(null)
        const res = await fetch('/api/holdings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: cleanedSymbol,
            shares: parsedShares,
            annualDividendPerShare: parsedAnnualDividend,
          }),
        })
        if (!res.ok) {
          const body = (await jsonOrNull(res)) as { error?: string } | null
          throw new Error(body?.error ?? `Failed to save holding (${res.status})`)
        }
        const data = (await res.json()) as { holding: Holding | undefined }
        if (!data.holding) throw new Error('Server did not return created holding')

        setHoldings((prev) => [data.holding as Holding, ...prev])
        setSymbol('')
        setShares('')
        setAnnualDividendPerShare('')
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
      if (!user) {
        setError('Please log in to remove holdings.')
        return
      }

      let previousHoldings: Holding[] | null = null
      setHoldings((prev) => {
        previousHoldings = prev
        return prev.filter((h) => h.id !== id)
      })

      try {
        setError(null)
        const res = await fetch(`/api/holdings/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!res.ok && res.status !== 204) {
          const body = (await jsonOrNull(res)) as { error?: string } | null
          throw new Error(body?.error ?? `Failed to delete holding (${res.status})`)
        }
      } catch (err) {
        if (previousHoldings) setHoldings(previousHoldings)
        setError(err instanceof Error ? err.message : 'Failed to delete holding')
      }
    }

    void remove()
  }

  return (
    <div className="page">
      <div className="pageInner">
        <header className="header">
          <div>
            <h1>Dividend Planner</h1>
            <p className="subtitle">Plan and estimate dividend income.</p>
          </div>

          <div className="headerRight">
            <div className="userBox">
              <div className="userMeta">
                <div>
                  <div className="userLabel">Signed in</div>
                  <div className="userEmail">{user?.email}</div>
                </div>
                <button type="button" onClick={logout}>
                  Log out
                </button>
              </div>
            </div>

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
          </div>
        </header>

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
            <p className="hint">
              {user ? 'Tip: enter annual dividend per share in USD.' : 'Log in to add holdings.'}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Portfolio</h2>
          {isLoading ? (
            <p className="empty">Loading…</p>
          ) : holdings.length === 0 ? (
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
                            disabled={!user}
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
      </div>
    </div>
  )
}
