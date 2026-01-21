import { useEffect, useMemo, useState } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getEodRange, type EodPoint } from './eodApi'

type TooltipPayload = {
  payload?: ChartPoint
}

function PriceChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean
  label?: string | number
  payload?: TooltipPayload[]
}) {
  if (!active || !payload || payload.length === 0) return null

  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '10px 12px',
        color: 'var(--text)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        {String(label ?? point.date)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: 6 }}>
        <div style={{ color: 'var(--muted)' }}>Close</div>
        <div style={{ textAlign: 'right' }}>{formatMoney2(point.close)}</div>
        <div style={{ color: 'var(--muted)' }}>Daily change</div>
        <div style={{ textAlign: 'right' }}>
          {typeof point.changePct === 'number' ? formatPercent(point.changePct) : '—'}
        </div>
      </div>
    </div>
  )
}

type RangeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'MAX'

type ChartPoint = {
  date: string
  close: number
  changePct: number | null
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

function toIsoDateUtc(d: Date): string {
  const yy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function addMonthsUtc(d: Date, months: number): Date {
  const next = new Date(d.getTime())
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function computeRange(range: RangeKey): { from: string; to: string } {
  const now = new Date()
  const to = toIsoDateUtc(now)
  if (range === '1W') {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return { from: toIsoDateUtc(d), to }
  }
  if (range === '1M') return { from: toIsoDateUtc(addMonthsUtc(now, -1)), to }
  if (range === '3M') return { from: toIsoDateUtc(addMonthsUtc(now, -3)), to }
  if (range === '6M') return { from: toIsoDateUtc(addMonthsUtc(now, -6)), to }
  if (range === '1Y') return { from: toIsoDateUtc(addMonthsUtc(now, -12)), to }
  return { from: '1970-01-01', to }
}

function withChangePct(points: EodPoint[]): ChartPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const out: ChartPoint[] = []
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!
    const prev = i > 0 ? sorted[i - 1]! : null
    const changePct = prev && prev.close !== 0 ? ((cur.close / prev.close) - 1) * 100 : null
    out.push({ date: cur.date, close: cur.close, changePct })
  }
  return out
}

type Props = {
  symbol: string
}

export default function PriceChart({ symbol }: Props) {
  const [range, setRange] = useState<RangeKey>('1M')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawPoints, setRawPoints] = useState<EodPoint[]>([])

  const { from, to } = useMemo(() => computeRange(range), [range])

  useEffect(() => {
    let cancelled = false

    if (!symbol.trim()) {
      setRawPoints([])
      setIsLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    ; (async () => {
      try {
        setIsLoading(true)
        setError(null)
        const res = await getEodRange(symbol.trim().toUpperCase(), from, to)
        if (!cancelled) {
          setRawPoints(Array.isArray(res.points) ? res.points : [])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chart')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [symbol, from, to])

  const points = useMemo(() => withChangePct(rawPoints), [rawPoints])

  return (
    <section className="panel">
      <div className="panelTabsTopRow" style={{ marginBottom: '1rem' }}>
        <h2 className="panelTabsTitle" style={{ margin: 0 }}>Price history ({range})</h2>
        <div className="actionsRow" aria-label="Range selector" style={{ gap: '0.25rem' }}>
          {(['1W', '1M', '3M', '6M', '1Y', 'MAX'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={k === range ? 'tab active' : 'tab'}
              style={{
                borderRadius: '99px',
                padding: '0.35rem 0.8rem',
                fontSize: '0.85rem',
                background: k === range ? 'var(--accent)' : 'transparent',
                color: k === range ? '#fff' : 'inherit',
                border: k === range ? 'none' : '1px solid var(--border)',
              }}
              onClick={() => setRange(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {!symbol.trim() ? <p className="empty">Select a symbol to view the chart.</p> : null}
      {error ? (
        <p className="error" role="alert" aria-live="polite">{error}</p>
      ) : null}

      {symbol.trim() ? (
        isLoading ? (
          <p className="empty">Loading…</p>
        ) : points.length === 0 ? (
          <p className="empty">No history available.</p>
        ) : (
          <div className="chartWrap" aria-label="Historical price chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={points} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={56}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: string | number) => (typeof v === 'number' ? v.toFixed(2) : String(v))}
                />
                <Tooltip
                  content={<PriceChartTooltip />}
                  labelFormatter={(label: string | number) => String(label)}
                />
                <Line type="monotone" dataKey="close" dot={false} stroke="var(--accent)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      ) : null}
    </section>
  )
}
