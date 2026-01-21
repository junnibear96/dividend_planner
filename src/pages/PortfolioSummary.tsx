import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getCashBalance, getCashBalanceCache, updateCashBalance } from '../features/portfolio/portfolioApi'

function formatMoney(value: number): string {
    return value.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
    })
}

type PortfolioSummaryProps = {
    value?: number | null
    onSave?: (amount: number) => Promise<void> | void
}

export default function PortfolioSummary({ value, onSave }: PortfolioSummaryProps = {}) {
    const { t } = useTranslation()
    const isControlled = value !== undefined
    const [internalCash, setInternalCash] = useState<number | null>(() => getCashBalanceCache())

    // In controlled mode, 'cash' comes from props. In uncontrolled (API) mode, it comes from internal state.
    const cash = isControlled ? value : internalCash

    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isControlled) return

        let active = true
        getCashBalance()
            .then((val) => {
                if (active) setInternalCash(val)
            })
            .catch((err) => console.error('Failed to fetch cash balance:', err))

        function onCashUpdate() {
            getCashBalance().then(val => {
                if (active) setInternalCash(val)
            })
        }
        window.addEventListener('dividend_cash_update', onCashUpdate)

        return () => {
            active = false
            window.removeEventListener('dividend_cash_update', onCashUpdate)
        }
    }, [isControlled])

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isEditing])

    function startEditing() {
        setEditValue(typeof cash === 'number' ? String(cash) : '')
        setIsEditing(true)
        setError(null)
    }

    function cancelEditing() {
        setIsEditing(false)
        setEditValue('')
        setError(null)
    }

    async function save() {
        setError(null)
        const next = parseFloat(editValue)
        if (isNaN(next) || next < 0) {
            setError(t('portfolio.summary.invalidAmount'))
            return
        }

        try {
            setIsSaving(true)
            if (isControlled && onSave) {
                await onSave(next)
            } else {
                const updated = await updateCashBalance(next)
                setInternalCash(updated)
            }
            setIsEditing(false)
        } catch (err) {
            setError(t('portfolio.summary.failedToSave'))
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <section className="panel" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{t('portfolio.summary.title')}</h2>
                {!isEditing && (
                    <button type="button" className="linkButton" onClick={startEditing} style={{ fontSize: '0.9rem' }}>
                        {t('portfolio.summary.edit')}
                    </button>
                )}
            </div>

            <div style={{ marginTop: '1rem', fontSize: '1.5rem', fontWeight: 500 }}>
                {isEditing ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="tableInput"
                            style={{ width: '150px', fontSize: '1.2rem', padding: '0.25rem' }}
                            placeholder="0.00"
                        />
                        <button type="button" onClick={() => void save()} disabled={isSaving} className="tableButton">
                            {t('portfolio.summary.save')}
                        </button>
                        <button type="button" onClick={cancelEditing} disabled={isSaving} className="tableButton" style={{ background: 'transparent', border: '1px solid var(--border)' }}>
                            {t('portfolio.summary.cancel')}
                        </button>
                    </div>
                ) : (
                    <span className="mono">
                        {typeof cash === 'number' ? formatMoney(cash) : '—'}
                    </span>
                )}
            </div>
            {error && <p className="error" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </section>
    )
}
