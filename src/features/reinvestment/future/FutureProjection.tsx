
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import FutureStats from './FutureStats'
import FutureChart from './FutureChart'
import { fetchSimulationProjection, type ProjectionResult } from '../reinvestmentApi'

export default function FutureProjection() {
    const { t } = useTranslation()
    const [timeframe, setTimeframe] = useState(10) // Years
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<ProjectionResult | null>(null)

    useEffect(() => {
        loadData()
    }, [timeframe])

    async function loadData() {
        setLoading(true)
        try {
            // assume 10% annual return for visualization
            const res = await fetchSimulationProjection(timeframe, 0.10)
            setData(res)
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const roi = data && data.totalInvested > 0
        ? (data.finalPortfolioValue - data.totalInvested) / data.totalInvested
        : 0

    return (
        <div className="futureProjection" style={{ padding: '2rem 0' }}>

            {/* Controls */}
            <div className="controls" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{t('future.title')}</h2>

                <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px' }}>
                    {[1, 3, 5, 10].map(yr => (
                        <button
                            key={yr}
                            onClick={() => setTimeframe(yr)}
                            style={{
                                background: timeframe === yr ? 'var(--bg-primary)' : 'transparent',
                                color: timeframe === yr ? 'var(--primary-color)' : 'var(--text-secondary)',
                                border: timeframe === yr ? '1px solid var(--border-color)' : 'none',
                                boxShadow: timeframe === yr ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: timeframe === yr ? 600 : 400,
                                transition: 'all 0.2s'
                            }}
                        >
                            {yr}Y
                        </button>
                    ))}
                </div>
            </div>

            {loading && !data && (
                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-tertiary)' }}>
                    {t('common.loading')}
                </div>
            )}

            {data && (
                <>
                    <FutureStats
                        invested={data.totalInvested}
                        value={data.finalPortfolioValue}
                        shares={data.totalShares}
                        roi={roi}
                    />

                    <FutureChart data={data.chartData} />
                </>
            )}
        </div>
    )
}
