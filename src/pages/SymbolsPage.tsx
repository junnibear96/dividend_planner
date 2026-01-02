import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listSymbols, type SymbolListItem } from '../features/symbols/symbolsApi'

function toInt(raw: string | null, fallback: number) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

export default function SymbolsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const q = String(searchParams.get('q') ?? '')
  const offset = Math.max(0, toInt(searchParams.get('offset'), 0))
  const limit = 100
  const exchange = 'US'

  const [items, setItems] = useState<SymbolListItem[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const nextParamsBase = useMemo(() => ({ q: q.trim(), offset: String(offset) }), [q, offset])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      try {
        setIsLoading(true)
        setError(null)
        const res = await listSymbols({ exchange, q, limit, offset, signal: controller.signal })
        if (!cancelled) {
          setItems(Array.isArray(res.items) ? res.items : [])
          setHasMore(Boolean(res.hasMore))
          setTotal(Number.isFinite(res.total) ? res.total : 0)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load symbols')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [exchange, q, limit, offset])

  function setQuery(nextQ: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      if (nextQ.trim()) p.set('q', nextQ)
      else p.delete('q')
      p.set('offset', '0')
      return p
    })
  }

  function prevPage() {
    goToOffset(Math.max(0, offset - limit))
  }

  function nextPage() {
    goToOffset(offset + limit)
  }

  function goToOffset(nextOffset: number) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('offset', String(Math.max(0, nextOffset)))
      if (!q.trim()) p.delete('q')
      return p
    })
  }

  const page = Math.floor(offset / limit) + 1
  const pageCount = Math.max(1, Math.ceil((total || 0) / limit))
  const start = total === 0 ? 0 : Math.min(total, offset + 1)
  const end = total === 0 ? 0 : Math.min(total, offset + items.length)

  function buildPageItems(): Array<{ kind: 'page'; n: number } | { kind: 'ellipsis'; key: string }> {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, i) => ({ kind: 'page', n: i + 1 }))
    }

    const want = new Set<number>()
    want.add(1)
    want.add(pageCount)
    for (let n = page - 2; n <= page + 2; n++) {
      if (n >= 1 && n <= pageCount) want.add(n)
    }
    const sorted = Array.from(want).sort((a, b) => a - b)

    const out: Array<{ kind: 'page'; n: number } | { kind: 'ellipsis'; key: string }> = []
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!
      const prev = i > 0 ? sorted[i - 1]! : null
      if (prev !== null && cur - prev > 1) {
        out.push({ kind: 'ellipsis', key: `${prev}_${cur}` })
      }
      out.push({ kind: 'page', n: cur })
    }
    return out
  }

  const pageItems = buildPageItems()

  function Pager() {
    return (
      <div className="actionsRow" style={{ alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div className="hint">
          {total > 0 ? (
            <>Showing {start}–{end} of {total}</>
          ) : (
            <>Showing {offset + 1}–{offset + items.length}</>
          )}
        </div>

        <div className="actionsRow" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }} aria-label="Pagination">
          <button type="button" className="navTab" onClick={prevPage} disabled={offset === 0}>
            Prev
          </button>

          {pageItems.map((it) => {
            if (it.kind === 'ellipsis') {
              return (
                <span key={it.key} className="hint" style={{ padding: '0 0.25rem' }}>
                  …
                </span>
              )
            }

            const isActive = it.n === page
            const pageOffset = (it.n - 1) * limit
            return (
              <button
                key={it.n}
                type="button"
                className={isActive ? 'navTab navTabActive' : 'navTab'}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => goToOffset(pageOffset)}
                disabled={isLoading}
              >
                {it.n}
              </button>
            )
          })}

          <button type="button" className="navTab" onClick={nextPage} disabled={!hasMore}>
            Next
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="pageInner">
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>All stocks (EODHD)</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Browse the cached EODHD symbol list (exchange: {exchange}).
          </p>

          <div className="actionsRow" style={{ alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="hint">Search (symbol or name)</span>
              <input
                value={q}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="AAPL, TSLA, SPY, Tesla…"
              />
            </label>
            <div style={{ flex: 1 }} />
            <Link className="tab" to={{ pathname: '/stock', search: '' }}>
              Back to Stock
            </Link>
          </div>
        </div>

        {error ? (
          <p className="error" role="alert" aria-live="polite">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty">No symbols found.</p>
        ) : (
          <div className="panel">
            <div style={{ marginBottom: '0.5rem' }}>
              <Pager />
            </div>

            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.symbol}>
                      <td>
                        <Link to={{ pathname: '/stock', search: `?symbol=${encodeURIComponent(it.symbol)}` }}>
                          {it.symbol}
                        </Link>
                      </td>
                      <td>{it.name ?? '—'}</td>
                      <td>{it.type ?? '—'}</td>
                      <td>{it.currency ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <Pager />
              <div className="hint" style={{ marginTop: '0.5rem' }}>Query: {nextParamsBase.q || '—'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
