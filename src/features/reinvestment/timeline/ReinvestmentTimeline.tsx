import { useMemo, useState } from 'react'
import MonthYearHeader, { type MonthYear } from './MonthYearHeader'
import { monthLabel, type MonthNumber } from './dateUtils'
import { buildMonthlyTimeline } from './buildMonthlyTimeline'
import type { GenerateWeeklyReinvestmentTimeline, Holdings, ReinvestmentExecutionWeek, TimelineShares, WeeklySlice } from './types'

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function formatDateRange(start: Date, end: Date): string {
  // Display day-of-month only (this is not a daily calendar).
  const s = start.getUTCDate()
  const e = end.getUTCDate()
  return s === e ? `${s}` : `${s}–${e}`
}

function totalShares(shares: TimelineShares): number {
  let sum = 0
  for (const v of Object.values(shares)) {
    const n = Number(v)
    if (Number.isFinite(n)) sum += n
  }
  return sum
}

function sharesDeltaLabel(shares: TimelineShares): string {
  const entries = Object.entries(shares).filter(([, v]) => Number(v) > 0)
  if (entries.length === 0) return '—'
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sym, v]) => `${sym}: +${Number(v).toFixed(6)}`)
    .join(', ')
}

export default function ReinvestmentTimeline(props: {
  initialMonth: MonthNumber
  initialYear: number

  // Compounding anchor. Ending shares flow from this month through the selected month.
  compoundingStartMonth: MonthNumber
  compoundingStartYear: number

  holdings: Holdings
  reinvestmentRules: unknown
  reinvestmentExecutions: ReinvestmentExecutionWeek[]
  generateWeeklyReinvestmentTimeline?: GenerateWeeklyReinvestmentTimeline

  now?: Date
}) {
  const {
    holdings,
    reinvestmentRules,
    reinvestmentExecutions,
    generateWeeklyReinvestmentTimeline,
    now,
    compoundingStartMonth,
    compoundingStartYear,
  } = props

  const [selected, setSelected] = useState<MonthYear>({ month: props.initialMonth, year: props.initialYear })
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false)
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false)

  const weeks: WeeklySlice[] = useMemo(() => {
    return buildMonthlyTimeline({
      selectedYear: selected.year,
      selectedMonth: selected.month,
      compoundingStartYear,
      compoundingStartMonth,
      holdings,
      reinvestmentRules,
      reinvestmentExecutions,
      generateWeeklyReinvestmentTimeline,
      now,
    })
  }, [
    selected.year,
    selected.month,
    compoundingStartYear,
    compoundingStartMonth,
    holdings,
    reinvestmentRules,
    reinvestmentExecutions,
    generateWeeklyReinvestmentTimeline,
    now,
  ])

  return (
    <section className="panel" aria-label="Dividend reinvestment timeline">
      <h2>Dividend Reinvestment Timeline</h2>
      <p className="subtitle">
        {monthLabel(selected.month)} {selected.year} — weekly slices with compounding across months.
      </p>

      <MonthYearHeader
        value={selected}
        onChange={setSelected}
        isMonthPickerOpen={isMonthPickerOpen}
        isYearPickerOpen={isYearPickerOpen}
        onToggleMonthPicker={() => {
          setIsMonthPickerOpen((v) => !v)
          setIsYearPickerOpen(false)
        }}
        onToggleYearPicker={() => {
          setIsYearPickerOpen((v) => !v)
          setIsMonthPickerOpen(false)
        }}
        onClosePickers={() => {
          setIsMonthPickerOpen(false)
          setIsYearPickerOpen(false)
        }}
      />

      <div className="timelineWeeks" aria-label="Weeks">
        {weeks.map((w) => {
          const cardClass =
            w.status === 'CURRENT'
              ? 'timelineWeekCard timelineWeekCardCurrent'
              : w.status === 'PAST'
                ? 'timelineWeekCard timelineWeekCardPast'
                : 'timelineWeekCard timelineWeekCardFuture'

          const nextDelta = w.nextWeekDividendEstimate - w.dividendEarned

          return (
            <div key={`${selected.year}-${selected.month}-w${w.weekIndex}`} className={cardClass} aria-label={`Week ${w.weekIndex}`}>
              <div className="timelineWeekTopRow">
                <div className="timelineWeekTitle">Week {w.weekIndex}</div>
                <div className="timelineWeekDates">
                  {monthLabel(selected.month)} {formatDateRange(w.startDate, w.endDate)}
                </div>
              </div>

              <div className="timelineWeekBody">
                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Dividend earned</div>
                  <div className="timelineMetricValue">{formatMoney(w.dividendEarned)}</div>
                </div>

                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Reinvested amount</div>
                  <div className="timelineMetricValue">{formatMoney(w.reinvestedAmount)}</div>
                </div>

                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Assets purchased</div>
                  <div className="timelineMetricValue timelineMono">{sharesDeltaLabel(w.sharesAdded)}</div>
                </div>

                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Shares added</div>
                  <div className="timelineMetricValue">{totalShares(w.sharesAdded).toFixed(6)}</div>
                </div>

                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Total shares after</div>
                  <div className="timelineMetricValue">{totalShares(w.endingShares).toFixed(6)}</div>
                </div>

                <div className="timelineMetric">
                  <div className="timelineMetricLabel">Next-week dividend change</div>
                  <div className="timelineMetricValue">
                    {Number.isFinite(nextDelta) ? (nextDelta >= 0 ? `+${formatMoney(nextDelta)}` : formatMoney(nextDelta)) : '—'}
                  </div>
                </div>
              </div>

              <div className="timelineWeekFooter">
                <span className="timelineWeekStatus">{w.status}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
