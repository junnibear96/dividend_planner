import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { parseYyyyMmDd } from '../features/stock/eodhd'
import SymbolAutocompleteInput from '../features/stock/SymbolAutocompleteInput'
import { getStockCached, searchStockSymbols } from '../features/stock/stockApi'
import { useAuth } from '../auth'
import PriceChart from '../features/stock/PriceChart'
import { listWatchlist, type WatchlistItem } from '../features/watchlist/watchlistApi'

type PricePoint = {
  date: string
  close: number
  volume: number | null
}

type DividendViewRow = {
  date: string
  value: number
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  })
}

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

function clampDateRows(rows: DividendViewRow[], days: number): DividendViewRow[] {
  const now = new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return rows.filter((r) => {
    const d = parseYyyyMmDd(r.date)
    return d ? d >= cutoff : false
  })
}

function normalizeRealTime(rt: unknown) {
  // Keep this permissive: EODHD plans/fields can vary.
  const obj = (rt ?? {}) as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name : undefined
  const exchange = typeof obj.exchange === 'string' ? obj.exchange : undefined

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

  const low = typeof obj.low === 'number' ? obj.low : undefined
  const high = typeof obj.high === 'number' ? obj.high : undefined

  return {
    name,
    exchange,
    close,
    previousClose,
    change,
    changePercent,
    low,
    high,
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="statLabel">{label}</div>
      <div className="statValue">{value}</div>
    </div>
  )
}

export default function StockPage() {
  const { user, isAuthLoading } = useAuth()
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  function normalizeSymbol(raw: string): string {
    const s = raw.trim().toUpperCase()
    if (!s) return ''
    return s.includes('.') ? s : `${s}.US`
  }

  const symbol = useMemo(() => {
    const raw = String(searchParams.get('symbol') ?? '')
    return normalizeSymbol(raw)
  }, [searchParams])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [realTimeRaw, setRealTimeRaw] = useState<unknown>(null)
  const [eod, setEod] = useState<PricePoint[]>([])
  const [dividends, setDividends] = useState<DividendViewRow[]>([])
  const [dividendFrequency, setDividendFrequency] = useState<string | null>(null)

  const [stockSearch, setStockSearch] = useState('')
  const [stockSearchSuggestions, setStockSearchSuggestions] = useState<string[]>([])

  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)

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
    const nextSymbol = normalizeSymbol(raw)
    if (!nextSymbol) return
    setSearchParams({ symbol: nextSymbol })
  }

  useEffect(() => {
    if (symbol) return
    if (isAuthLoading) return
    if (!user) {
      setWatchlistItems([])
      setWatchlistError(null)
      return
    }

    let cancelled = false
      ; (async () => {
        try {
          setWatchlistLoading(true)
          setWatchlistError(null)
          const items = await listWatchlist()
          if (!cancelled) setWatchlistItems(items)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load watchlist'
          if (!cancelled) setWatchlistError(msg)
        } finally {
          if (!cancelled) setWatchlistLoading(false)
        }
      })()

    return () => {
      cancelled = true
    }
  }, [symbol, user, isAuthLoading])

  useEffect(() => {
    let cancelled = false

    if (!symbol) {
      setIsLoading(false)
      setError(null)
      setRealTimeRaw(null)
      setEod([])
      setEod([])
      setDividends([])
      setDividendFrequency(null)
      return () => {
        cancelled = true
      }
    }

    async function load() {
      try {
        setIsLoading(true)
        setError(null)

        const data = await getStockCached(symbol, 30)

        if (cancelled) return

        setRealTimeRaw(data.realtime)

        const points: PricePoint[] = (Array.isArray(data.eod) ? data.eod : [])
          .filter((r) => r && typeof r.date === 'string' && typeof r.close === 'number')
          .map((r) => ({
            date: r.date,
            close: r.close,
            volume: typeof r.volume === 'number' ? r.volume : null,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
        setEod(points)

        const div: DividendViewRow[] = (Array.isArray(data.dividends) ? data.dividends : [])
          .filter((r) => r && typeof r.date === 'string' && typeof r.value === 'number')
          .map((r) => ({ date: r.date, value: r.value }))
          .sort((a, b) => b.date.localeCompare(a.date))
        setDividends(div)
        setDividendFrequency(data.dividendFrequency)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load stock data')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [symbol])

  const rt = useMemo(() => normalizeRealTime(realTimeRaw), [realTimeRaw])

  const currentPrice = rt.close ?? (eod.length ? eod[eod.length - 1].close : undefined)
  const previousClose = rt.previousClose

  const derivedChange = useMemo(() => {
    if (typeof currentPrice !== 'number' || typeof previousClose !== 'number') return null
    const c = currentPrice - previousClose
    const p = previousClose !== 0 ? (c / previousClose) * 100 : 0
    return { change: c, changePercent: p }
  }, [currentPrice, previousClose])

  const change = rt.change ?? derivedChange?.change
  const changePercent = rt.changePercent ?? derivedChange?.changePercent

  const dailyRange = useMemo(() => {
    const low = rt.low
    const high = rt.high
    if (typeof low !== 'number' || typeof high !== 'number') return null
    return { low, high }
  }, [rt.low, rt.high])

  const avgVol30 = useMemo(() => {
    const vols = eod
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    if (vols.length === 0) return null
    const sum = vols.reduce((a, b) => a + b, 0)
    return sum / vols.length
  }, [eod])

  const dividendRowsLast6 = useMemo(() => dividends.slice(0, 6), [dividends])

  const annualDividendSum = useMemo(() => {
    const rows = clampDateRows(dividends, 365)
    const sum = rows.reduce((acc, r) => acc + r.value, 0)
    return sum
  }, [dividends])

  const dividendYield = useMemo(() => {
    if (typeof currentPrice !== 'number' || currentPrice <= 0) return null
    return (annualDividendSum / currentPrice) * 100
  }, [annualDividendSum, currentPrice])

  // 52-week range: mocked for MVP (per requirement)
  const range52w = { low: 0, high: 0 }

  const isEtf = Boolean(rt.name && rt.name.toLowerCase().includes('etf'))

  return (
    <div className="page">
      <div className="pageInner">
        <div className="stockHeaderSearch">
          <form className="stockSearch" onSubmit={onStockSearch} role="search">
            <SymbolAutocompleteInput
              value={stockSearch}
              onValueChange={setStockSearch}
              suggestions={stockSearchSuggestions}
              placeholder={t('stock.searchPlaceholder')}
            />
            <button type="submit" disabled={!stockSearch.trim()}>
              {t('stock.search')}
            </button>
          </form>
        </div>

        {!symbol ? (
          <div className="stockLandingGrid">
            <section className="panel">
              <div className="panelTabsTopRow" style={{ marginBottom: '0.5rem' }}>
                <h2 className="panelTabsTitle" style={{ margin: 0 }}>
                  {t('stock.watchlist.title')}
                </h2>
                <div className="actionsRow">
                  <Link className="linkButton" to="/watchlist">
                    {t('stock.watchlist.manage')}
                  </Link>
                </div>
              </div>

              {isAuthLoading ? <p className="empty">{t('stock.watchlist.loading')}</p> : !user ? (
                <p className="empty">
                  {t('stock.watchlist.loginPrompt')} <Link className="linkButton" to="/login">{t('stock.watchlist.loginLink')}</Link>
                </p>
              ) : watchlistError ? (
                <p className="error" role="alert" aria-live="polite">
                  {watchlistError}
                </p>
              ) : watchlistLoading ? (
                <p className="empty">{t('stock.watchlist.loading')}</p>
              ) : watchlistItems.length === 0 ? (
                <p className="empty">{t('stock.watchlist.empty')}</p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('watchlist.table.symbol')}</th>
                        <th>{t('watchlist.table.name')}</th>
                        <th className="num">{t('watchlist.table.price')}</th>
                        <th className="num">{t('watchlist.table.change')}</th>
                        <th className="num">{t('watchlist.table.changePercent')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {watchlistItems.map((it) => {
                        const changeV = typeof it.change === 'number' ? it.change : null
                        const changeP = typeof it.changePercent === 'number' ? it.changePercent : null
                        const changeClass =
                          changeV !== null ? (changeV > 0 ? 'profitPos' : changeV < 0 ? 'profitNeg' : '') : ''

                        return (
                          <tr key={it.id}>
                            <td>
                              <a
                                className="linkButton"
                                href={`/stock?symbol=${encodeURIComponent(it.symbol)}`}
                              >
                                {it.symbol}
                              </a>
                            </td>
                            <td>{it.name ?? '—'}</td>
                            <td className="num">{typeof it.price === 'number' ? it.price.toFixed(2) : '—'}</td>
                            <td className={`num ${changeClass}`}>{changeV !== null ? formatSigned(changeV, 2) : '—'}</td>
                            <td className={`num ${changeClass}`}>{changeP !== null ? formatPercent(changeP) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <aside className="panel">
              <h2 style={{ marginTop: 0 }}>{t('stock.quickLinks.title')}</h2>
              <div className="stack">
                <Link className="linkButton" to="/watchlist">
                  {t('stock.quickLinks.openWatchlist')}
                </Link>
                <Link className="linkButton" to="/home">
                  {t('stock.quickLinks.openPortfolio')}
                </Link>
              </div>
            </aside>
          </div>
        ) : (
          <>
            <header className="stockHeader">
              <div>
                <div className="stockTitleRow">
                  <h1 className="stockTitle">{rt.name ?? symbol}</h1>
                  {isEtf ? <span className="chip">ETF</span> : null}
                </div>
                <div className="stockMeta">
                  <span>{symbol}</span>
                  {rt.exchange ? <span className="dot">•</span> : null}
                  {rt.exchange ? <span>{rt.exchange}</span> : null}
                </div>
              </div>

              <div className="priceBox" aria-label="Current price">
                <div className="priceValue">
                  {typeof currentPrice === 'number' ? formatMoney2(currentPrice) : '—'}
                </div>
                <div className="priceChange">
                  {typeof change === 'number' && typeof changePercent === 'number' ? (
                    <span>
                      {formatSigned(change, 2)} ({formatPercent(changePercent)})
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
            </header>

            {error ? (
              <section className="panel">
                <h2>{t('stock.error.title')}</h2>
                <p className="error" role="alert" aria-live="polite">
                  {error}
                </p>
                <p className="hint">
                  {t('stock.error.hint')}
                </p>
              </section>
            ) : null}

            <div style={{ marginBottom: '1rem' }}>
              <PriceChart symbol={symbol} />
            </div>

            <section className="panel">
              <h2>{t('stock.stats.title')}</h2>
              <div className="statsGrid">
                <Stat
                  label={t('stock.stats.previousClose')}
                  value={
                    typeof previousClose === 'number' ? formatMoney2(previousClose) : '—'
                  }
                />
                <Stat
                  label={t('stock.stats.dailyRange')}
                  value={
                    dailyRange
                      ? `${formatMoney2(dailyRange.low)} ~ ${formatMoney2(dailyRange.high)}`
                      : '—'
                  }
                />
                <Stat
                  label={t('stock.stats.range52w')}
                  value={
                    range52w.low === 0 && range52w.high === 0
                      ? '— (mocked)'
                      : `${formatMoney2(range52w.low)} ~ ${formatMoney2(range52w.high)}`
                  }
                />
                <Stat
                  label={t('stock.stats.avgVolume')}
                  value={typeof avgVol30 === 'number' ? avgVol30.toLocaleString() : '—'}
                />
              </div>
            </section>

            <section className="panel">
              <h2>{t('stock.dividends.title')}</h2>
              <div className="divSummary">
                <div>
                  <div className="statLabel">{t('stock.dividends.annualSum')}</div>
                  <div className="divValue">{formatMoney(annualDividendSum)}</div>
                </div>
                <div>
                  <div className="statLabel">{t('stock.dividends.yield')}</div>
                  <div className="divValue">
                    {typeof dividendYield === 'number' ? `${dividendYield.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="statLabel">{t('stock.dividends.yield')}</div>
                  <div className="divValue">
                    {typeof dividendYield === 'number' ? `${dividendYield.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="statLabel">Frequency</div>
                  <div className="divValue">
                    {dividendFrequency ? dividendFrequency : '—'}
                  </div>
                </div>
              </div>

              {isLoading ? (
                <p className="empty">{t('stock.dividends.loading')}</p>
              ) : dividendRowsLast6.length === 0 ? (
                <p className="empty">{t('stock.dividends.empty')}</p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('stock.dividends.table.date')}</th>
                        <th className="num">{t('stock.dividends.table.dividend')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dividendRowsLast6.map((d) => (
                        <tr key={`${d.date}_${d.value}`}>
                          <td className="mono">{d.date}</td>
                          <td className="num mono">{formatMoney(d.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
