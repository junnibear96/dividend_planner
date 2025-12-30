import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { parseYyyyMmDd } from '../features/stock/eodhd'
import { getStockCached } from '../features/stock/stockApi'

const DEFAULT_SYMBOL = 'TSLY.US'

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
  const [searchParams] = useSearchParams()
  const symbol = (searchParams.get('symbol') ?? DEFAULT_SYMBOL).trim().toUpperCase()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [realTimeRaw, setRealTimeRaw] = useState<unknown>(null)
  const [eod, setEod] = useState<PricePoint[]>([])
  const [dividends, setDividends] = useState<DividendViewRow[]>([])

  useEffect(() => {
    let cancelled = false

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
            <h2>Data error</h2>
            <p className="error" role="alert" aria-live="polite">
              {error}
            </p>
            <p className="hint">
              Make sure the API server has `EODHD_API_TOKEN` configured and can reach
              EODHD from the server (and that your DB is reachable for caching).
            </p>
          </section>
        ) : null}

        <section className="panel">
          <h2>Price history (1M)</h2>
          {isLoading ? (
            <p className="empty">Loading…</p>
          ) : eod.length === 0 ? (
            <p className="empty">No history available.</p>
          ) : (
            <div className="chartWrap" aria-label="Price history chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={eod} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    width={56}
                    domain={['auto', 'auto']}
                    tickFormatter={(v: string | number) =>
                      typeof v === 'number' ? v.toFixed(2) : String(v)
                    }
                  />
                  <Tooltip
                    formatter={(value: string | number | undefined) =>
                      typeof value === 'number' ? formatMoney2(value) : String(value ?? '')
                    }
                    labelFormatter={(label: string | number) => String(label)}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    dot={false}
                    stroke="var(--accent)"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Stats</h2>
          <div className="statsGrid">
            <Stat
              label="Previous close"
              value={
                typeof previousClose === 'number' ? formatMoney2(previousClose) : '—'
              }
            />
            <Stat
              label="Daily range"
              value={
                dailyRange
                  ? `${formatMoney2(dailyRange.low)} ~ ${formatMoney2(dailyRange.high)}`
                  : '—'
              }
            />
            <Stat
              label="52-week range"
              value={
                range52w.low === 0 && range52w.high === 0
                  ? '— (mocked)'
                  : `${formatMoney2(range52w.low)} ~ ${formatMoney2(range52w.high)}`
              }
            />
            <Stat
              label="Average volume (30D)"
              value={typeof avgVol30 === 'number' ? avgVol30.toLocaleString() : '—'}
            />
          </div>
        </section>

        <section className="panel">
          <h2>Dividends</h2>
          <div className="divSummary">
            <div>
              <div className="statLabel">Annual dividend (last 12 months)</div>
              <div className="divValue">{formatMoney(annualDividendSum)}</div>
            </div>
            <div>
              <div className="statLabel">Dividend yield</div>
              <div className="divValue">
                {typeof dividendYield === 'number' ? `${dividendYield.toFixed(2)}%` : '—'}
              </div>
            </div>
          </div>

          {isLoading ? (
            <p className="empty">Loading…</p>
          ) : dividendRowsLast6.length === 0 ? (
            <p className="empty">No dividend history available.</p>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Dividend</th>
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
      </div>
    </div>
  )
}
