import { useTranslation } from 'react-i18next'

export type WeekIndex = 1 | 2 | 3 | 4

export default function WeekTabs(props: {
  value: WeekIndex
  onChange: (v: WeekIndex) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { value, onChange, disabled } = props

  return (
    <div className="weekTabs" role="tablist" aria-label={t('reinvestment.weeks')}>
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
          {t('reinvestment.week', { week: w })}
        </button>
      ))}
    </div>
  )
}
