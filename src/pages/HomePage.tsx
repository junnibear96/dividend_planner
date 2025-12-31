import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import { searchStockSymbols, type StockApiResponse, getStockCached } from '../features/stock/stockApi'
import {
  createPortfolioPosition,
  listPortfolio,
  updatePortfolioPosition,
  type PortfolioPosition,
} from '../features/portfolio/portfolioApi'

function formatMoney2(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function formatSigned(value: number, digits = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

function formatPercent(value: number): string {
  return `${formatSigned(value, 2)}%`
}

function normalizeRealTime(rt: unknown) {
  const obj = (rt ?? {}) as Record<string, unknown>

  const close =
    typeof obj.close === 'number'
      ? obj.close
      : typeof obj.price === 'number'
        ? obj.price
        : typeof obj.last === 'number'
          ? obj.last
          : undefined

  const previousClose =
    typeof obj.previousClose === 'number'
      ? obj.previousClose
      : typeof obj.previous_close === 'number'
        ? obj.previous_close
        : undefined

  const change = typeof obj.change === 'number' ? obj.change : undefined
  const changePercent =
    typeof obj.change_p === 'number'
      ? obj.change_p
      : typeof obj.changePercent === 'number'
        ? obj.changePercent
        : undefined

  return {
    close,
    previousClose,
    change,
    changePercent,
  }
}

type QuoteView = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePercent: number | null
  source: StockApiResponse['source'] | null
}

async function loadQuote(symbol: string): Promise<QuoteView> {
  const data = await getStockCached(symbol, 2)
  const rt = normalizeRealTime(data.realtime)

  const eodLast = data.eod.length ? data.eod[data.eod.length - 1].close : undefined
  const price = typeof rt.close === 'number' ? rt.close : typeof eodLast === 'number' ? eodLast : null

  const previousClose = typeof rt.previousClose === 'number' ? rt.previousClose : null

  let change = typeof rt.change === 'number' ? rt.change : null
  let changePercent = typeof rt.changePercent === 'number' ? rt.changePercent : null

  if (change === null && typeof price === 'number' && typeof previousClose === 'number') {
    change = price - previousClose
  }
  if (changePercent === null && typeof change === 'number' && typeof previousClose === 'number') {
    changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0
  }

  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    source: data.source,
  }
}

export default function HomePage() {
  const navigate = useNavigate()

  const [stockSearch, setStockSearch] = useState('')
  const [stockSearchSuggestions, setStockSearchSuggestions] = useState<string[]>([])

  const [positions, setPositions] = useState<PortfolioPosition[]>([])
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, QuoteView | undefined>>({})

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [symbolDraft, setSymbolDraft] = useState('')
  const [amountDraft, setAmountDraft] = useState('')
  const [buyPriceDraft, setBuyPriceDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const [rowDraftAmount, setRowDraftAmount] = useState<Record<string, string>>({})
  const [rowDraftBuyPrice, setRowDraftBuyPrice] = useState<Record<string, string>>({})
  const [rowSavingId, setRowSavingId] = useState<string | null>(null)

  useEffect(() => {
    const q = symbolDraft.trim()
    if (!q) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const t = window.setTimeout(() => {
      void searchStockSymbols(q, 10, controller.signal)
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

  function onStockSearch(e: React.FormEvent) {
    e.preventDefault()
    const raw = stockSearch.trim()
    if (!raw) return
    const nextSymbol = raw.toUpperCase()
    const url = `/stock?symbol=${encodeURIComponent(nextSymbol)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setIsLoading(true)
        setError(null)

        const next = await listPortfolio()
        if (cancelled) return
        setPositions(next)

        setRowDraftAmount((prev) => {
          const out: Record<string, string> = { ...prev }
          for (const p of next) {
            if (out[p.id] === undefined) out[p.id] = String(p.amount)
          }
          return out
        })

        setRowDraftBuyPrice((prev) => {
          const out: Record<string, string> = { ...prev }
          for (const p of next) {
            if (out[p.id] === undefined) {
              out[p.id] = typeof p.buyPrice === 'number' ? String(p.buyPrice) : ''
            }
          }
          return out
        })

        const uniqueSymbols = Array.from(
          new Set(next.map((p) => p.symbol.trim().toUpperCase()).filter(Boolean)),
        )

        const results = await Promise.all(
          uniqueSymbols.map(async (s) => {
            try {
              const q = await loadQuote(s)
              return [s, q] as const
            } catch {
              return [s, { symbol: s, price: null, previousClose: null, change: null, changePercent: null, source: null }] as const
            }
          }),
        )

        if (cancelled) return
        setQuotesBySymbol(Object.fromEntries(results))
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load portfolio')
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

  const totals = useMemo(() => {
    let totalValue = 0
    let totalCost = 0
    let totalProfit = 0
    let hasProfit = false

    for (const p of positions) {
      const q = quotesBySymbol[p.symbol]
      if (q && typeof q.price === 'number') {
        totalValue += q.price * p.amount

        if (typeof p.buyPrice === 'number') {
          totalCost += p.buyPrice * p.amount
          totalProfit += (q.price - p.buyPrice) * p.amount
          hasProfit = true
        }
      }
    }

    const profit = hasProfit ? totalProfit : null
    const profitPercent = hasProfit && totalCost !== 0 ? (totalProfit / totalCost) * 100 : null

    return { totalValue, profit, profitPercent }
  }, [positions, quotesBySymbol])

  async function addPosition(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const symbol = symbolDraft.trim().toUpperCase()
    const amount = Number(amountDraft)
    const buyPrice = buyPriceDraft.trim() ? Number(buyPriceDraft) : null

    if (!symbol) {
      setError('Symbol is required')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      return
    }

    if (buyPrice !== null && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
      setError('Buy price must be a positive number')
      return
    }

    try {
      setIsSaving(true)
      const created = await createPortfolioPosition({ symbol, amount, buyPrice })
      setPositions((prev) => [created, ...prev])
      setRowDraftAmount((prev) => ({ ...prev, [created.id]: String(created.amount) }))
      setRowDraftBuyPrice((prev) => ({
        ...prev,
        [created.id]: typeof created.buyPrice === 'number' ? String(created.buyPrice) : '',
      }))
      setSymbolDraft('')
      setAmountDraft('')
      setBuyPriceDraft('')

      if (!quotesBySymbol[symbol]) {
        void loadQuote(symbol)
          .then((q) => setQuotesBySymbol((prev) => ({ ...prev, [symbol]: q })))
          .catch(() => {
            setQuotesBySymbol((prev) => ({
              ...prev,
              [symbol]: { symbol, price: null, previousClose: null, change: null, changePercent: null, source: null },
            }))
          })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add position')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveRowAmount(id: string) {
    setError(null)

    const draft = rowDraftAmount[id]
    const amount = Number(draft)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      return
    }

    const buyPriceDraftValue = (rowDraftBuyPrice[id] ?? '').trim()
    const buyPrice = buyPriceDraftValue ? Number(buyPriceDraftValue) : null
    if (buyPrice !== null && (!Number.isFinite(buyPrice) || buyPrice <= 0)) {
      setError('Buy price must be a positive number')
      return
    }

    try {
      setRowSavingId(id)
      const updated = await updatePortfolioPosition(id, { amount, buyPrice })
      setPositions((prev) => prev.map((p) => (p.id === id ? updated : p)))
      setRowDraftAmount((prev) => ({ ...prev, [id]: String(updated.amount) }))
      setRowDraftBuyPrice((prev) => ({
        ...prev,
        [id]: typeof updated.buyPrice === 'number' ? String(updated.buyPrice) : '',
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update position')
    } finally {
      setRowSavingId(null)
    }
  }

  return (
    <div className="page">
      <div className="pageInner">
        <header className="portfolioHeader">
          <div>
            <h1>Home</h1>
            <p className="subtitle">Today’s portfolio snapshot.</p>
          </div>

          <div className="portfolioHeaderRight">
            <form className="stockSearch portfolioSearch" onSubmit={onStockSearch} role="search">
              <SymbolAutocompleteInput
                value={stockSearch}
                onValueChange={setStockSearch}
                suggestions={stockSearchSuggestions}
                placeholder="Search symbol (e.g. TSLY.US)"
              />
              <button type="submit" disabled={!stockSearch.trim()}>
                Search
              </button>
            </form>

            <div className="summaryCard">
              <div className="summaryKey">Total value</div>
              <div className="summaryValue">{formatMoney2(totals.totalValue)}</div>
              <div
                className={
                  typeof totals.profit === 'number'
                    ? ['priceChange', totals.profit >= 0 ? 'profitPos' : 'profitNeg'].join(' ')
                    : 'priceChange'
                }
              >
                {typeof totals.profit === 'number' && typeof totals.profitPercent === 'number' ? (
                  <span>
                    Profit {formatSigned(totals.profit, 2)} ({formatPercent(totals.profitPercent)})
                  </span>
                ) : (
                  <span>Profit —</span>
                )}
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <section className="panel">
            <h2>Problem</h2>
            <p className="error" role="alert" aria-live="polite">
              {error}
            </p>
          </section>
        ) : null}

        <section className="panel">
          <h2>Add stock/etf</h2>
          <form className="form" onSubmit={addPosition}>
            <label className="field">
              <span>Symbol</span>
              <SymbolAutocompleteInput
                value={symbolDraft}
                onValueChange={setSymbolDraft}
                suggestions={suggestions}
                placeholder="e.g. TSLY.US"
                disabled={isSaving}
              />
            </label>

            <label className="field">
              <span>Amount</span>
              <input
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
                placeholder="e.g. 10"
                inputMode="decimal"
                disabled={isSaving}
              />
            </label>

            <label className="field">
              <span>Buy price (optional)</span>
              <input
                value={buyPriceDraft}
                onChange={(e) => setBuyPriceDraft(e.target.value)}
                placeholder="e.g. 37.50"
                inputMode="decimal"
                disabled={isSaving}
              />
            </label>

            <div className="actions">
              <button type="submit" disabled={isSaving || !symbolDraft.trim() || !amountDraft.trim()}>
                Add
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Portfolio</h2>
          {isLoading ? (
            <p className="empty">Loading…</p>
          ) : positions.length === 0 ? (
            <p className="empty">No positions yet.</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Price</th>
                    <th className="num">Change</th>
                    <th className="num">Buy price</th>
                    <th className="num">Amount</th>
                    <th className="num">Value</th>
                    <th className="num">Profit</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const q = quotesBySymbol[p.symbol]
                    const price = q?.price ?? null
                    const value = typeof price === 'number' ? price * p.amount : null
                    const draft = rowDraftAmount[p.id] ?? String(p.amount)
                    const buyDraft = rowDraftBuyPrice[p.id] ?? (typeof p.buyPrice === 'number' ? String(p.buyPrice) : '')
                    const isRowSaving = rowSavingId === p.id

                    const buyPrice = typeof p.buyPrice === 'number' ? p.buyPrice : null
                    const profitPerShare =
                      typeof price === 'number' && typeof buyPrice === 'number' ? price - buyPrice : null
                    const profitPercent =
                      typeof profitPerShare === 'number' && buyPrice && buyPrice !== 0
                        ? (profitPerShare / buyPrice) * 100
                        : null

                    const profitClass =
                      typeof profitPerShare === 'number'
                        ? profitPerShare >= 0
                          ? 'profitPos'
                          : 'profitNeg'
                        : ''

                    return (
                      <tr key={p.id}>
                        <td>
                          <button
                            type="button"
                            className="linkButton"
                            onClick={() => navigate(`/stock?symbol=${encodeURIComponent(p.symbol)}`)}
                          >
                            {p.symbol}
                          </button>
                        </td>
                        <td className="num mono">
                          {typeof price === 'number' ? formatMoney2(price) : '—'}
                        </td>
                        <td className="num mono">
                          {q && typeof q.change === 'number' && typeof q.changePercent === 'number'
                            ? `${formatSigned(q.change, 2)} (${formatPercent(q.changePercent)})`
                            : '—'}
                        </td>
                        <td className="num">
                          <input
                            className="tableInput"
                            value={buyDraft}
                            onChange={(e) =>
                              setRowDraftBuyPrice((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            inputMode="decimal"
                            aria-label={`Buy price for ${p.symbol}`}
                            disabled={isRowSaving}
                            placeholder="—"
                          />
                        </td>
                        <td className="num">
                          <input
                            className="tableInput"
                            value={draft}
                            onChange={(e) =>
                              setRowDraftAmount((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            inputMode="decimal"
                            aria-label={`Amount for ${p.symbol}`}
                            disabled={isRowSaving}
                          />
                        </td>
                        <td className="num mono">
                          {typeof value === 'number' ? formatMoney2(value) : '—'}
                        </td>
                        <td className={['num', 'mono', profitClass].filter(Boolean).join(' ')}>
                          {typeof profitPerShare === 'number' && typeof profitPercent === 'number'
                            ? `${formatSigned(profitPerShare, 2)} (${formatPercent(profitPercent)})`
                            : '—'}
                        </td>
                        <td className="num">
                          <button
                            type="button"
                            className="tableButton"
                            onClick={() => void saveRowAmount(p.id)}
                            disabled={isRowSaving}
                          >
                            {isRowSaving ? 'Saving…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
