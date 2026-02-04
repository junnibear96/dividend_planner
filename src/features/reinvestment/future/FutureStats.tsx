

import { useTranslation } from 'react-i18next'

type Props = {
    invested: number
    value: number
    shares: number
    roi: number
}

export default function FutureStats({ invested, value, shares, roi }: Props) {
    const { t } = useTranslation()

    const cardStyle = {
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '0.5rem',
        minWidth: '200px',
        flex: 1
    }

    const labelStyle = {
        color: 'var(--text-secondary)',
        fontSize: '0.9rem',
        fontWeight: 500
    }

    const valueStyle = {
        fontSize: '1.5rem',
        fontWeight: 700,
        color: 'var(--text-primary)'
    }

    return (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            <div style={cardStyle}>
                <span style={labelStyle}>{t('future.stats.projectedValue')}</span>
                <span style={{ ...valueStyle, color: 'var(--primary-color)' }}>
                    {value.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                </span>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{t('future.stats.totalShares')}</span>
                <span style={valueStyle}>
                    {shares.toFixed(2)} Shares
                </span>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{t('future.stats.totalInvested')}</span>
                <span style={valueStyle}>
                    {invested.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                </span>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{t('future.stats.roi')}</span>
                <span style={{ ...valueStyle, color: roi >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {roi > 0 ? '+' : ''}{(roi * 100).toFixed(1)}%
                </span>
            </div>
        </div>
    )
}
