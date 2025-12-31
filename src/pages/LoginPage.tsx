import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import UserAuth from '../UserAuth'
import { useAuth } from '../auth'
import DividendPlanner, { type PlannerHolding, type UpdateHoldingInput } from '../features/planner/DividendPlanner'

function createId() {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
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
      navigate('/home', { replace: true })
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
          ) : null}

          {isWide ? (
            <div className="loginLeft">
              <div className="loginCard">
                <UserAuth
                  user={user}
                  onUserChange={(next) => {
                    setUser(next)
                    if (next) navigate('/home', { replace: true })
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
                    navigate('/home', { replace: true })
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
