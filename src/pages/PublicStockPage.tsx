import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import { searchStockSymbols } from '../features/stock/stockApi'
import PriceChart from '../features/stock/PriceChart'
import {
  listRecommendations,
  type RecommendedStock,
} from '../features/recommendations/recommendationsApi'

function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (!s) return ''
  return s.includes('.') ? s : `${s}.US`
}

export default function PublicStockPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const symbol = useMemo(() => normalizeSymbol(String(searchParams.get('symbol') ?? '')), [searchParams])

  const [stockSearch, setStockSearch] = useState('')
  const [stockSearchSuggestions, setStockSearchSuggestions] = useState<string[]>([])

  const [recs, setRecs] = useState<RecommendedStock[]>([])
  const [recsLoading, setRecsLoading] = useState(true)
  const [recsError, setRecsError] = useState<string | null>(null)

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

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    const next = normalizeSymbol(stockSearch)
    if (!next) return
    setSearchParams({ symbol: next })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setRecsLoading(true)
        setRecsError(null)
        const items = await listRecommendations()
        if (!cancelled) setRecs(items)
      } catch (err) {
        if (!cancelled) setRecsError(err instanceof Error ? err.message : 'Failed to load recommendations')
      } finally {
        if (!cancelled) setRecsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <div className="pageInner">
        <div className="stockHeaderSearch">
          <form className="stockSearch" onSubmit={onSearch} role="search">
            <SymbolAutocompleteInput
              value={stockSearch}
              onValueChange={setStockSearch}
              suggestions={stockSearchSuggestions}
              placeholder="주식, ETF 등 검색"
            />
            <button type="submit" disabled={!stockSearch.trim()}>
              Search
            </button>
          </form>
          <div className="hint" style={{ marginTop: '0.5rem' }}>
            <Link to="/symbols">Browse all symbols</Link>
          </div>
        </div>

        <div className="stockLandingGrid">
          <div className="stack">
            <PriceChart symbol={symbol} />
          </div>

          <aside className="panel">
            <h2 style={{ marginTop: 0 }}>Recommended for You</h2>
            {recsError ? <p className="error" role="alert" aria-live="polite">{recsError}</p> : null}
            {recsLoading ? (
              <p className="empty">Loading…</p>
            ) : recs.length === 0 ? (
              <p className="empty">No recommendations available yet.</p>
            ) : (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Name</th>
                      <th className="num">Price</th>
                      <th className="num">Score</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.slice(0, 5).map((r) => (
                      <tr key={`${r.symbol}_${r.exchange}`}>
                        <td>
                          <button
                            type="button"
                            className="linkButton"
                            onClick={() => setSearchParams({ symbol: r.symbol })}
                          >
                            {r.symbol}
                          </button>
                        </td>
                        <td>{r.name}</td>
                        <td className="num">{Number.isFinite(r.price) ? r.price.toFixed(2) : '—'}</td>
                        <td className="num">{Number.isFinite(r.score) ? r.score.toFixed(3) : '—'}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
