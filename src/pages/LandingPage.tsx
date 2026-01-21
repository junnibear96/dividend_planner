import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import DividendPlanner, { type PlannerHolding, type UpdateHoldingInput } from '../features/planner/DividendPlanner'
import PortfolioSummary from './PortfolioSummary'

function createId() {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export default function LandingPage() {
  const { user, isAuthLoading } = useAuth()
  const navigate = useNavigate()
  const [stockSearch, setStockSearch] = useState('')
  const [guestCash, setGuestCash] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('guest_cash_balance')
      return saved ? Number(saved) : 0
    } catch {
      return 0
    }
  })

  function updateGuestCash(val: number) {
    setGuestCash(val)
    localStorage.setItem('guest_cash_balance', String(val))
  }

  useEffect(() => {
    if (!isAuthLoading && user) {
      navigate('/home', { replace: true })
    }
  }, [isAuthLoading, user, navigate])

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
        <div className="landingGrid">
          <div className="landingHero">
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

          <div className="landingPlanner">
            {/* Guest Planner is always visible on landing unless logged in (which redirects anyway) */}
            <DividendPlanner
              mode="guest"
              showSummary
              canWrite={true}
              createHolding={async (input) => ({ id: createId(), ...input })}
              updateHolding={async (holding: PlannerHolding, input: UpdateHoldingInput) => ({
                ...holding,
                ...input,
              })}
              deleteHolding={async () => {
                // no-op in guest mode
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
