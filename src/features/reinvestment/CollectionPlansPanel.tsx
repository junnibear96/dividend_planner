
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
    type CollectionPlan,
    fetchCollectionPlans,
    deleteCollectionPlan,
    updateCollectionPlan,
} from './reinvestmentApi'
import StockGatheringForm from './StockGatheringForm'

// Inline helper to avoid import issues
function formatMoney(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Props = {
    // Callback to trigger a refresh of the timeline/simulation
    onPlanChange?: () => void
}

export default function CollectionPlansPanel({ onPlanChange }: Props) {
    const { t } = useTranslation()
    const [plans, setPlans] = useState<CollectionPlan[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isCreating, setIsCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        loadPlans()
    }, [onPlanChange])

    async function loadPlans() {
        setIsLoading(true)
        setError(null)
        try {
            const data = await fetchCollectionPlans()
            setPlans(data)
        } catch (err) {
            console.error(err)
            setError('Failed to load plans. Check server connection.')
        } finally {
            setIsLoading(false)
        }
    }

    async function handleDelete(id: number) {
        if (!confirm(t('common.confirmDelete'))) return
        try {
            await deleteCollectionPlan(id)
            loadPlans()
            onPlanChange?.()
        } catch (err) {
            console.error(err)
            alert('Failed to delete plan')
        }
    }

    async function toggleStatus(plan: CollectionPlan) {
        try {
            const newStatus = plan.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
            await updateCollectionPlan(plan.id, { status: newStatus })
            loadPlans()
            onPlanChange?.()
        } catch (err) {
            console.error(err)
            alert('Failed to update status')
        }
    }

    return (
        <div className="reinvestmentPanel">
            <div className="panelHeader">
                <h2>{t('reinvestment.collectionPlans.title', 'My Gathering Plans')}</h2>
                {!isCreating && (
                    <button className="button primary small" onClick={() => setIsCreating(true)}>
                        + {t('common.add')}
                    </button>
                )}
            </div>

            {isCreating && (
                <div style={{ marginBottom: 20 }}>
                    <StockGatheringForm
                        onSuccess={() => {
                            setIsCreating(false)
                            loadPlans()
                            onPlanChange?.()
                        }}
                        onCancel={() => setIsCreating(false)}
                    />
                </div>
            )}

            <div className="planList">
                {isLoading ? (
                    <div style={{ padding: 20 }}>{t('common.loading')}...</div>
                ) : error ? (
                    <div style={{ padding: 20, color: 'var(--error-color, red)' }}>
                        {error} <br />
                        <button onClick={loadPlans} style={{ marginTop: 10 }}>Retry</button>
                    </div>
                ) : plans.length === 0 && !isCreating ? (
                    <div className="emptyState">{t('reinvestment.collectionPlans.empty', 'No active plans. Start gathering stocks!')}</div>
                ) : (
                    plans.map((plan) => (
                        <div key={plan.id} className={`planCard ${plan.status.toLowerCase()}`}>
                            <div className="planIcon">
                                <div className="stockAvatar">{plan.targetStock.substring(0, 2)}</div>
                            </div>
                            <div className="planDetails">
                                <div className="planTitle">{plan.targetStock}</div>
                                <div className="planMeta">
                                    {plan.investmentType === 'QUANTITY'
                                        ? `${plan.amount} shares`
                                        : `${plan.currency === 'KRW' ? '₩' : '$'}${formatMoney(plan.amount)}`}
                                    {' / '}
                                    {t(`frequency.${plan.frequency}`)}
                                </div>
                            </div>
                            <div className="planActions">
                                <button
                                    className="iconButton"
                                    title={plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                    onClick={() => toggleStatus(plan)}
                                >
                                    {plan.status === 'ACTIVE' ? '⏸' : '▶'}
                                </button>
                                <button className="iconButton danger" onClick={() => handleDelete(plan.id)}>🗑</button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <style>{`
        .reinvestmentPanel {
          background: var(--surface-card);
          border-radius: 12px;
          padding: 24px;
          border: 1px solid var(--border-color);
        }
        .panelHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .planCard {
            display: flex;
            align-items: center;
            padding: 12px;
            border-bottom: 1px solid var(--border-color);
            gap: 12px;
        }
        .planCard.paused {
            opacity: 0.6;
        }
        .stockAvatar {
            width: 40px;
            height: 40px;
            background: var(--primary-color);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        .planDetails {
            flex: 1;
        }
        .iconButton {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 16px;
            opacity: 0.7;
            color: var(--text-primary);
        }
        .iconButton:hover {
            opacity: 1;
        }
        .iconButton.danger:hover {
            color: var(--error-color, red);
        }
      `}</style>
        </div>
    )
}
