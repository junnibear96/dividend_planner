import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { searchStockSymbols } from '../features/stock/stockApi'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import DividendPlanner, {
  type CreateHoldingInput,
  type PlannerHolding,
  type UpdateHoldingInput,
} from '../features/planner/DividendPlanner'
import ReinvestmentPanel from '../features/reinvestment/ReinvestmentPanel'
import WeekTabs, { type WeekIndex } from '../features/reinvestment/WeekTabs'
import type { ScheduleMode } from '../features/reinvestment/reinvestmentApi'

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

  const userId = user?.id ?? null

  const [stockSearch, setStockSearch] = useState('')
  const [stockSearchSuggestions, setStockSearchSuggestions] = useState<string[]>([])

  useEffect(() => {
    const q = stockSearch.trim()
    if (!q) {
      setStockSearchSuggestions([])
      return
    }

    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void searchStockSymbols(q, 10, controller.signal)
        .then(setStockSearchSuggestions)
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setStockSearchSuggestions([])
        })
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [stockSearch])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    navigate('/login', { replace: true })
  }

  function onStockSearch(e: React.FormEvent) {
    e.preventDefault()
    const raw = stockSearch.trim()
    if (!raw) return
    const nextSymbol = raw.toUpperCase()
    const url = `/stock?symbol=${encodeURIComponent(nextSymbol)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const canWrite = Boolean(user)
  const loadHoldings = useCallback(async (): Promise<PlannerHolding[]> => {
    if (!userId) return []
    const res = await fetch('/api/holdings')
    if (!res.ok) {
      const body = (await jsonOrNull(res)) as { error?: string } | null
      throw new Error(body?.error ?? `Failed to load holdings (${res.status})`)
    }
    const data = (await res.json()) as { holdings: PlannerHolding[] | undefined }
    return Array.isArray(data.holdings) ? data.holdings : []
  }, [userId])

  const [isReinvestOpen, setIsReinvestOpen] = useState(false)
  const [reinvestWeek, setReinvestWeek] = useState<WeekIndex>(1)
  const [reinvestScheduleMode, setReinvestScheduleMode] = useState<ScheduleMode>('FIXED')

  async function createHolding(input: CreateHoldingInput): Promise<PlannerHolding> {
    const res = await fetch('/api/holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = (await jsonOrNull(res)) as { error?: string } | null
      throw new Error(body?.error ?? `Failed to save holding (${res.status})`)
    }
    const data = (await res.json()) as { holding: PlannerHolding | undefined }
    if (!data.holding) throw new Error('Server did not return created holding')
    return data.holding
  }

  async function updateHolding(
    holding: PlannerHolding,
    input: UpdateHoldingInput,
  ): Promise<PlannerHolding> {
    const res = await fetch(`/api/holdings/${encodeURIComponent(holding.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = (await jsonOrNull(res)) as { error?: string } | null
      throw new Error(body?.error ?? `Failed to update holding (${res.status})`)
    }
    const data = (await res.json()) as { holding: PlannerHolding | undefined }
    if (!data.holding) throw new Error('Server did not return updated holding')
    return data.holding
  }

  async function deleteHolding(id: string): Promise<void> {
    const res = await fetch(`/api/holdings/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 204) {
      const body = (await jsonOrNull(res)) as { error?: string } | null
      throw new Error(body?.error ?? `Failed to delete holding (${res.status})`)
    }
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
            {user ? (
              <div className="summary" aria-label="Reinvestment">
                <button type="button" onClick={() => setIsReinvestOpen(true)}>
                  Reinvest
                </button>
                <button type="button" className="linkButton" onClick={() => navigate('/reinvest')}>
                  Open page
                </button>
              </div>
            ) : null}

            <form className="stockSearch" onSubmit={onStockSearch} role="search">
              <SymbolAutocompleteInput
                value={stockSearch}
                onValueChange={setStockSearch}
                suggestions={stockSearchSuggestions}
                placeholder="Search symbol (e.g., TSLY.US)"
              />
              <button type="submit" disabled={!stockSearch.trim()}>
                Search
              </button>
            </form>

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
          </div>
        </header>

        <DividendPlanner
          mode="user"
          showSummary
          canWrite={canWrite}
          loadHoldings={user ? loadHoldings : undefined}
          createHolding={createHolding}
          updateHolding={updateHolding}
          deleteHolding={deleteHolding}
        />

        {isReinvestOpen ? (
          <div
            className="modalOverlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsReinvestOpen(false)
            }}
          >
            <div className="modalDialog modalWide modalScrollable" role="dialog" aria-modal="true" aria-label="Reinvest">
              <div className="modalHeader">
                <div className="modalTitle">Reinvest</div>
                <div className="actionsRow">
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => {
                      setIsReinvestOpen(false)
                      navigate('/reinvest')
                    }}
                  >
                    Open page
                  </button>
                  <button type="button" className="modalClose" onClick={() => setIsReinvestOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
              {reinvestScheduleMode === 'WEEK_OF_MONTH' ? (
                <div className="modalTabs">
                  <WeekTabs value={reinvestWeek} onChange={setReinvestWeek} />
                </div>
              ) : null}
              <div className="modalBody">
                <ReinvestmentPanel
                  activeWeek={reinvestWeek}
                  onActiveWeekChange={setReinvestWeek}
                  onScheduleModeChange={setReinvestScheduleMode}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
