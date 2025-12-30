export type WeekIndex = 1 | 2 | 3 | 4

export default function WeekTabs(props: {
  value: WeekIndex
  onChange: (v: WeekIndex) => void
  disabled?: boolean
}) {
  const { value, onChange, disabled } = props

  return (
    <div className="weekTabs" role="tablist" aria-label="Weeks">
      {([1, 2, 3, 4] as const).map((w) => (
        <button
          key={w}
          type="button"
          role="tab"
          aria-selected={value === w}
          className={value === w ? 'weekTab weekTabActive' : 'weekTab'}
          onClick={() => onChange(w)}
          disabled={disabled}
        >
          Week {w}
        </button>
      ))}
    </div>
  )
}
