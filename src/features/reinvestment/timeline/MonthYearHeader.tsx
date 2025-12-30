import { useMemo } from 'react'
import { MONTH_NAMES_SHORT, addMonths, monthLabel, type MonthNumber } from './dateUtils'

export type MonthYear = {
  month: MonthNumber
  year: number
}

export default function MonthYearHeader(props: {
  value: MonthYear
  onChange: (next: MonthYear) => void
  isMonthPickerOpen: boolean
  isYearPickerOpen: boolean
  onToggleMonthPicker: () => void
  onToggleYearPicker: () => void
  onClosePickers: () => void
}) {
  const {
    value,
    onChange,
    isMonthPickerOpen,
    isYearPickerOpen,
    onToggleMonthPicker,
    onToggleYearPicker,
    onClosePickers,
  } = props

  const years = useMemo(() => {
    // Deterministic 12-year grid centered around the selected year.
    const start = value.year - 6
    return Array.from({ length: 12 }, (_, i) => start + i)
  }, [value.year])

  return (
    <div className="timelineHeader">
      <div className="timelineHeaderRow" aria-label="Month and year navigation">
        <button
          type="button"
          className="timelineNavButton"
          aria-label="Previous month"
          onClick={() => {
            const next = addMonths(value.year, value.month, -1)
            onClosePickers()
            onChange({ year: next.year, month: next.month })
          }}
        >
          {'<'}
        </button>

        <div className="timelineHeaderTitle" aria-label="Selected month and year">
          <button
            type="button"
            className={isMonthPickerOpen ? 'timelinePickButton timelinePickButtonActive' : 'timelinePickButton'}
            aria-haspopup="grid"
            aria-expanded={isMonthPickerOpen}
            onClick={onToggleMonthPicker}
          >
            {monthLabel(value.month)}
          </button>
          <span className="timelineHeaderSpacer" aria-hidden="true">
            {' '}
          </span>
          <button
            type="button"
            className={isYearPickerOpen ? 'timelinePickButton timelinePickButtonActive' : 'timelinePickButton'}
            aria-haspopup="grid"
            aria-expanded={isYearPickerOpen}
            onClick={onToggleYearPicker}
          >
            {value.year}
          </button>
        </div>

        <button
          type="button"
          className="timelineNavButton"
          aria-label="Next month"
          onClick={() => {
            const next = addMonths(value.year, value.month, 1)
            onClosePickers()
            onChange({ year: next.year, month: next.month })
          }}
        >
          {'>'}
        </button>
      </div>

      {isMonthPickerOpen ? (
        <div className="timelinePicker" aria-label="Select month">
          <div className="timelinePickerGrid" role="grid" aria-label="Months">
            {MONTH_NAMES_SHORT.map((label, idx) => {
              const month = (idx + 1) as MonthNumber
              const selected = month === value.month
              return (
                <button
                  key={label}
                  type="button"
                  role="gridcell"
                  className={selected ? 'timelinePickerCell timelinePickerCellActive' : 'timelinePickerCell'}
                  aria-selected={selected}
                  onClick={() => {
                    onChange({ year: value.year, month })
                    onClosePickers()
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {isYearPickerOpen ? (
        <div className="timelinePicker" aria-label="Select year">
          <div className="timelinePickerGrid" role="grid" aria-label="Years">
            {years.map((y) => {
              const selected = y === value.year
              return (
                <button
                  key={y}
                  type="button"
                  role="gridcell"
                  className={selected ? 'timelinePickerCell timelinePickerCellActive' : 'timelinePickerCell'}
                  aria-selected={selected}
                  onClick={() => {
                    onChange({ year: y, month: value.month })
                    onClosePickers()
                  }}
                >
                  {y}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
