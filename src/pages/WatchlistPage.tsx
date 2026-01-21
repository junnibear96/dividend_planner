import { useEffect, useMemo, useState } from 'react'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import {
  addToWatchlist,
  listWatchlist,
  refreshWatchlist,
  removeFromWatchlist,
  searchWatchlistSymbols,
  type WatchlistItem,
} from '../features/watchlist/watchlistApi'

function formatSigned(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

function formatPercent(value: number): string {
  return `${formatSigned(value, 2)}%`
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [symbolDraft, setSymbolDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function load() {
    const next = await listWatchlist()
    setItems(next)
  }

  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          setIsLoading(true)
          setError(null)
          const next = await listWatchlist()
          if (!cancelled) setItems(next)
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load watchlist')
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const q = symbolDraft.trim()
    if (!q) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void searchWatchlistSymbols(q, 10, 'US', controller.signal)
        .then(setSuggestions)
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSuggestions([])
        })
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(t)
    }
  }, [symbolDraft])

  const canAdd = useMemo(() => Boolean(symbolDraft.trim()), [symbolDraft])

  async function onAdd(e: React.FormEvent) {
    e.preventDefault()
    const raw = symbolDraft.trim()
    if (!raw) return

    try {
      setIsSaving(true)
      setError(null)
      await addToWatchlist(raw)
      setSymbolDraft('')
      setSuggestions([])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add symbol')
    } finally {
      setIsSaving(false)
    }
  }

  async function onRefresh() {
    try {
      setIsRefreshing(true)
      setError(null)
      await refreshWatchlist()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh')
    } finally {
      setIsRefreshing(false)
    }
  }

  async function onRemove(symbol: string) {
    try {
      setError(null)
      await removeFromWatchlist(symbol)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  return (
    <div className="page">
      <div className="pageInner">
        <div className="panel">
          <div className="portfolioHeader">
            <div className="stack" style={{ gap: '0.25rem' }}>
              <h2 style={{ margin: 0 }}>Watchlist</h2>
              <div className="summaryKey">EODHD (cached) quotes + fundamentals</div>
            </div>

            <div className="portfolioHeaderRight">
              <form id="watchlist-add-form" className="portfolioSearch" onSubmit={onAdd}>
                <SymbolAutocompleteInput
                  value={symbolDraft}
                  onValueChange={setSymbolDraft}
                  suggestions={suggestions}
                  placeholder="Add symbol (e.g. TSLY or TSLY.US)"
                  disabled={isSaving || isRefreshing}
                />
              </form>

              <div className="summaryCard">
                <div className="summaryKey">Items</div>
                <div className="summaryValue">{items.length}</div>
              </div>

              <button
                type="button"
                className="tableButton"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>

              <button
                type="submit"
                className="tableButton"
                form="watchlist-add-form"
                onClick={(e) => {
                  if (!canAdd) e.preventDefault()
                }}
                disabled={!canAdd || isSaving || isRefreshing}
              >
                {isSaving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>

          {error ? <p className="empty" style={{ color: 'var(--danger)' }}>{error}</p> : null}
          {isLoading ? <p className="empty">Loading…</p> : null}

          {!isLoading ? (
            items.length === 0 ? (
              <p className="empty">No watchlist items yet.</p>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Name</th>
                      <th className="num">Price</th>
                      <th className="num">Change</th>
                      <th className="num">Change %</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const change = typeof it.change === 'number' ? it.change : null
                      const changePercent = typeof it.changePercent === 'number' ? it.changePercent : null
                      const changeClass = change !== null ? (change > 0 ? 'profitPos' : change < 0 ? 'profitNeg' : '') : ''

                      return (
                        <tr key={it.id}>
                          <td>
                            <a
                              className="linkButton"
                              href={`/stock?symbol=${encodeURIComponent(it.symbol)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {it.symbol}
                            </a>
                          </td>
                          <td>{it.name ?? '—'}</td>
                          <td className="num">
                            {typeof it.price === 'number' ? it.price.toFixed(2) : '—'}
                          </td>
                          <td className={`num ${changeClass}`}>
                            {change !== null ? formatSigned(change, 2) : '—'}
                          </td>
                          <td className={`num ${changeClass}`}>
                            {changePercent !== null ? formatPercent(changePercent) : '—'}
                          </td>
                          <td className="num">
                            <button
                              type="button"
                              className="linkButton"
                              onClick={() => void onRemove(it.symbol)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
