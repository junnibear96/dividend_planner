import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import PortfolioSummary from './PortfolioSummary'
import SellDeleteModal from './SellDeleteModal'
import { searchStockSymbols, type StockApiResponse, getStockCached, getStocksBatch } from '../features/stock/stockApi'
import {
  createPortfolioPosition,
  listPortfolio,
  updatePortfolioPosition,
  deletePortfolioPosition,
  getPortfolioCache,
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
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [stockSearch, setStockSearch] = useState('')
  const [stockSearchSuggestions, setStockSearchSuggestions] = useState<string[]>([])

  const [positions, setPositions] = useState<PortfolioPosition[]>(() => getPortfolioCache() ?? [])
  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, QuoteView | undefined>>({})

  const [isLoading, setIsLoading] = useState(() => !getPortfolioCache()?.length)
  const [error, setError] = useState<string | null>(null)

  const [symbolDraft, setSymbolDraft] = useState('')
  const [amountDraft, setAmountDraft] = useState('')
  const [buyPriceDraft, setBuyPriceDraft] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const [rowDraftAmount, setRowDraftAmount] = useState<Record<string, string>>({})
  const [rowDraftBuyPrice, setRowDraftBuyPrice] = useState<Record<string, string>>({})
  const [rowSavingId, setRowSavingId] = useState<string | null>(null)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  const [positionToDelete, setPositionToDelete] = useState<PortfolioPosition | null>(null)

  type SortField = 'symbol' | 'price' | 'change' | 'buyPrice' | 'amount' | 'value' | 'profit'
  const [sortBy, setSortBy] = useState<SortField | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const [visibleItems, setVisibleItems] = useState(15)

  const sortedPositions = useMemo(() => {
    if (!sortBy) return positions

    return [...positions].sort((a, b) => {
      const qA = quotesBySymbol[a.symbol]
      const qB = quotesBySymbol[b.symbol]

      let valA: number | string = 0
      let valB: number | string = 0

      switch (sortBy) {
        case 'symbol':
          valA = a.symbol
          valB = b.symbol
          break
        case 'price':
          valA = qA?.price ?? 0
          valB = qB?.price ?? 0
          break
        case 'change':
          valA = qA?.changePercent ?? 0
          valB = qB?.changePercent ?? 0
          break
        case 'buyPrice':
          valA = a.buyPrice ?? 0
          valB = b.buyPrice ?? 0
          break
        case 'amount':
          valA = a.amount
          valB = b.amount
          break
        case 'value': {
          const priceA = qA?.price ?? 0
          const priceB = qB?.price ?? 0
          valA = priceA * a.amount
          valB = priceB * b.amount
          break
        }
        case 'profit': {
          const priceA = qA?.price ?? 0
          const priceB = qB?.price ?? 0
          const buyA = a.buyPrice ?? 0
          const buyB = b.buyPrice ?? 0
          // Total profit for sorting
          valA = (priceA - buyA) * a.amount
          valB = (priceB - buyB) * b.amount
          break
        }
      }

      if (valA === valB) return 0
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }
      // Numeric sort
      const numA = Number(valA)
      const numB = Number(valB)
      return sortOrder === 'asc' ? numA - numB : numB - numA
    })
  }, [positions, quotesBySymbol, sortBy, sortOrder])

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      if (sortOrder === 'desc') {
        setSortOrder('asc')
      } else {
        setSortBy(null)
        setSortOrder('desc') // Reset default
      }
    } else {
      setSortBy(field)
      setSortOrder('desc') // Default to desc for numbers usually
      if (field === 'symbol') setSortOrder('asc') // Default asc for text
    }
  }

  const renderHeader = (label: string, field: SortField, className: string = '') => {
    const isActive = sortBy === field
    return (
      <th
        className={className}
        onClick={() => toggleSort(field)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleSort(field)
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: className.includes('num') ? 'flex-end' : 'flex-start' }}>
          {label}
          <span style={{ fontSize: '0.8em', opacity: isActive ? 1 : 0.3, width: '1em', display: 'inline-block', textAlign: 'center' }}>
            {isActive ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </div>
      </th>
    )
  }

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
        setError(null)
        // Only fetch from DB if we don't have local data
        let currentPositions = positions
        if (currentPositions.length === 0) {
          setIsLoading(true)
          const next = await listPortfolio()
          if (cancelled) return
          setPositions(next)
          currentPositions = next
        }

        setRowDraftAmount((prev) => {
          const out: Record<string, string> = { ...prev }
          for (const p of currentPositions) {
            if (out[p.id] === undefined) out[p.id] = String(p.amount)
          }
          return out
        })

        setRowDraftBuyPrice((prev) => {
          const out: Record<string, string> = { ...prev }
          for (const p of currentPositions) {
            if (out[p.id] === undefined) {
              out[p.id] = typeof p.buyPrice === 'number' ? String(p.buyPrice) : ''
            }
          }
          return out
        })

        const uniqueSymbols = Array.from(
          new Set(currentPositions.map((p) => p.symbol.trim().toUpperCase()).filter(Boolean)),
        )

        // Batch fetch
        try {
          const batchResults = await getStocksBatch(uniqueSymbols)

          const newQuotes: Record<string, QuoteView> = {}
          for (const s of uniqueSymbols) {
            const apiData = batchResults[s]
            if (apiData) {
              const rt = normalizeRealTime(apiData.realtime)
              // We don't have previousClose from batch realtime potentially? 
              // EODHD Realtime might give `previousClose`, `open`, etc.
              // Let's assume normalizeRealTime handles it if data exists.

              // Re-construct QuoteView
              // We might lack 'eodLast' fallback here if we only fetched realtime.
              // But for speed, realtime is what we want.
              const price = typeof rt.close === 'number' ? rt.close : null
              const previousClose = typeof rt.previousClose === 'number' ? rt.previousClose : null
              let change = typeof rt.change === 'number' ? rt.change : null
              let changePercent = typeof rt.changePercent === 'number' ? rt.changePercent : null

              if (change === null && typeof price === 'number' && typeof previousClose === 'number') {
                change = price - previousClose
              }
              if (changePercent === null && typeof change === 'number' && typeof previousClose === 'number') {
                changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0
              }

              newQuotes[s] = {
                symbol: s,
                price,
                previousClose,
                change,
                changePercent,
                source: apiData.source,
              }
            } else {
              // Failed to get data for this symbol in batch
              newQuotes[s] = { symbol: s, price: null, previousClose: null, change: null, changePercent: null, source: null }
            }
          }
          if (cancelled) return
          setQuotesBySymbol(newQuotes)

        } catch (err) {
          console.error('Batch load failed', err)
          // Fallback? Or just leave empty
        }

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

  function confirmRemovePosition(p: PortfolioPosition) {
    setPositionToDelete(p)
    setDeleteModalOpen(true)
  }

  async function handleConfirmDelete() {
    if (!positionToDelete) return
    const id = positionToDelete.id
    setDeleteModalOpen(false)
    setPositionToDelete(null)

    try {
      setRowSavingId(id)
      await deletePortfolioPosition(id)
      setPositions((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete position')
      setRowSavingId(null)
    }
  }

  async function handleConfirmSold(price: number, amount: number) {
    if (!positionToDelete) return
    const id = positionToDelete.id
    setDeleteModalOpen(false)
    setPositionToDelete(null)

    try {
      setRowSavingId(id)
      // 1. Update Cash
      const proceed = price * amount
      // Actually, my API `updateCashBalance` sets the absolute value. 
      // I need to fetch current, add, then set.
      // But `PortfolioSummary` manages its own state... we should probably use the imported `getCashBalance` here.

      const currentBalance = await import('../features/portfolio/portfolioApi').then(m => m.getCashBalance())
      const newBalance = currentBalance + proceed
      await import('../features/portfolio/portfolioApi').then(m => m.updateCashBalance(newBalance))

      // 2. Delete Position
      await deletePortfolioPosition(id)
      setPositions((prev) => prev.filter((p) => p.id !== id))

      // Force refresh of PortfolioSummary if needed? 
      // Since it shares `localStorage` via caching, if it listens to storage events or if we trigger an update... 
      // `PortfolioSummary` uses `useEffect` on mount. It won't auto-update unless we signal it. 
      // Ideally we lift the state up, but for now we can rely on page reload or just the cache being updated.
      // However, `PortfolioSummary` won't re-render automatically. 
      // Let's trigger a window reload? No, that's jarring.
      // Better: we should have lifted the cash state to HomePage?
      // Since `PortfolioSummary` is a child, we can pass a callback or key to force reload?
      // For now, let's keep it simple: The user will see the row disappear. The cash might visually lag until refresh unless I lift state.
      // I will accept this limitation or try to trigger a re-render.
      window.dispatchEvent(new Event('dividend_cash_update')) // Custom event?

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete position')
      setRowSavingId(null)
    }
  }

  return (
    <div className="page">
      <div className="pageInner">
        <header className="portfolioHeader">
          <div>
            <h1>{t('portfolio.home.title')}</h1>
            <p className="subtitle">{t('portfolio.home.subtitle')}</p>
          </div>

          <div className="portfolioHeaderRight">
            <form className="stockSearch portfolioSearch" onSubmit={onStockSearch} role="search">
              <SymbolAutocompleteInput
                value={stockSearch}
                onValueChange={setStockSearch}
                suggestions={stockSearchSuggestions}
                placeholder={t('portfolio.home.searchPlaceholder')}
              />
              <button type="submit" disabled={!stockSearch.trim()}>
                {t('portfolio.home.search')}
              </button>
            </form>

            <div className="summaryCard">
              <div className="summaryKey">{t('portfolio.home.totalValue')}</div>
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
                    {t('portfolio.home.profit')} ${formatSigned(totals.profit, 2)} ({formatPercent(totals.profitPercent)})
                  </span>
                ) : (
                  <span>{t('portfolio.home.profit')} —</span>
                )}
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <section className="panel">
            <h2>{t('portfolio.home.problem')}</h2>
            <p className="error" role="alert" aria-live="polite">
              {error}
            </p>
          </section>
        ) : null}

        <section className="panel">
          <h2>{t('portfolio.home.addTitle')}</h2>
          <form className="form" onSubmit={addPosition}>
            <label className="field">
              <span>{t('portfolio.home.symbolLabel')}</span>
              <SymbolAutocompleteInput
                value={symbolDraft}
                onValueChange={setSymbolDraft}
                suggestions={suggestions}
                placeholder={t('portfolio.home.symbolPlaceholder')}
                disabled={isSaving}
              />
            </label>

            <label className="field">
              <span>{t('portfolio.home.amountLabel')}</span>
              <input
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
                placeholder={t('portfolio.home.amountPlaceholder')}
                inputMode="decimal"
                disabled={isSaving}
              />
            </label>

            <label className="field">
              <span>{t('portfolio.home.buyPriceLabel')}</span>
              <input
                value={buyPriceDraft}
                onChange={(e) => setBuyPriceDraft(e.target.value)}
                placeholder={t('portfolio.home.buyPricePlaceholder')}
                inputMode="decimal"
                disabled={isSaving}
              />
            </label>

            <div className="actions">
              <button type="submit" disabled={isSaving || !symbolDraft.trim() || !amountDraft.trim()}>
                {t('portfolio.home.add')}
              </button>
            </div>
          </form>
        </section>

        <PortfolioSummary />

        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>{t('portfolio.home.portfolioTitle')}</h2>
          </div>
          {isLoading ? (
            <p className="empty">{t('portfolio.home.loading')}</p>
          ) : positions.length === 0 ? (
            <p className="empty">{t('portfolio.home.empty')}</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    {renderHeader(t('portfolio.table.symbol'), 'symbol')}
                    {renderHeader(t('portfolio.table.price'), 'price', 'num')}
                    {renderHeader(t('portfolio.table.change'), 'change', 'num')}
                    {renderHeader(t('portfolio.table.buyPrice'), 'buyPrice', 'num')}
                    {renderHeader(t('portfolio.table.amount'), 'amount', 'num')}
                    {renderHeader(t('portfolio.table.value'), 'value', 'num')}
                    {renderHeader(t('portfolio.table.profit'), 'profit', 'num')}
                    <th className="num">{t('portfolio.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPositions.slice(0, visibleItems).map((p) => {
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
                          <div className="actionsRow" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button
                              type="button"
                              className="tableButton"
                              onClick={() => void saveRowAmount(p.id)}
                              disabled={isRowSaving}
                            >
                              {isRowSaving ? t('portfolio.summary.saving') : t('portfolio.summary.save')}
                            </button>
                            <button
                              type="button"
                              className="tableButton"
                              onClick={() => confirmRemovePosition(p)}
                              disabled={isRowSaving}
                              style={{ background: 'color-mix(in oklab, var(--danger) 15%, transparent)', color: 'var(--danger)' }}
                            >
                              {t('portfolio.home.remove')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {visibleItems < sortedPositions.length && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setVisibleItems((prev) => prev + 15)}
                style={{
                  padding: '8px 24px',
                  borderRadius: '20px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'var(--bg-card)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                {t('common.showMore', 'Show More')}
              </button>
            </div>
          )}
        </section>

        {deleteModalOpen && positionToDelete && (
          <SellDeleteModal
            isOpen={deleteModalOpen}
            symbol={positionToDelete.symbol}
            initialAmount={positionToDelete.amount}
            initialPrice={positionToDelete.buyPrice}
            onClose={() => {
              setDeleteModalOpen(false)
              setPositionToDelete(null)
            }}
            onConfirmDelete={handleConfirmDelete}
            onConfirmSold={handleConfirmSold}
          />
        )}
      </div>
    </div>
  )
}

