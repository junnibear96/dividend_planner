import { useState, useEffect, useRef } from 'react'

type SellDeleteModalProps = {
    isOpen: boolean
    onClose: () => void
    onConfirmDelete: () => void
    onConfirmSold: (price: number, amount: number) => void
    symbol: string
    initialAmount: number
    initialPrice: number | null
}

export default function SellDeleteModal({
    isOpen,
    onClose,
    onConfirmDelete,
    onConfirmSold,
    symbol,
    initialAmount,
    initialPrice,
}: SellDeleteModalProps) {
    const [step, setStep] = useState<'choice' | 'sell_details'>('choice')
    const [priceStr, setPriceStr] = useState('')
    const [amountStr, setAmountStr] = useState('')
    const firstInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (isOpen) {
            setStep('choice')
            setPriceStr(initialPrice ? String(initialPrice) : '')
            setAmountStr(String(initialAmount))
        }
    }, [isOpen, initialAmount, initialPrice])

    useEffect(() => {
        if (step === 'sell_details' && firstInputRef.current) {
            firstInputRef.current.focus()
        }
    }, [step])

    if (!isOpen) return null

    const price = parseFloat(priceStr)
    const amount = parseFloat(amountStr)
    const total = isNaN(price) || isNaN(amount) ? 0 : price * amount

    function handleSoldSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (isNaN(price) || price < 0 || isNaN(amount) || amount <= 0) {
            alert('Please enter valid positive numbers.')
            return
        }
        onConfirmSold(price, amount)
    }

    return (
        <div className="modalOverlay" onClick={onClose}>
            <div className="modalDialog" onClick={(e) => e.stopPropagation()}>
                <div className="modalHeader">
                    <h3 className="modalTitle">Remove {symbol}</h3>
                    <button onClick={onClose} className="modalClose" aria-label="Close">×</button>
                </div>

                {step === 'choice' && (
                    <div className="modalBody">
                        <p style={{ marginBottom: '1.5rem', lineHeight: 1.6 }}>
                            Did you sell this position or do you just want to remove it?
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                            <button
                                type="button"
                                style={{
                                    flex: 1,
                                    padding: '0.85rem 1rem',
                                    borderRadius: '12px',
                                    fontWeight: 600,
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    border: '1px solid var(--accent)',
                                    background: 'var(--accent)',
                                    color: '#fff',
                                    transition: 'all 0.2s',
                                }}
                                onClick={() => setStep('sell_details')}
                            >
                                Sold
                            </button>
                            <button
                                type="button"
                                style={{
                                    flex: 1,
                                    padding: '0.85rem 1rem',
                                    borderRadius: '12px',
                                    fontWeight: 600,
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    border: '1px solid var(--danger)',
                                    background: 'transparent',
                                    color: 'var(--danger)',
                                    transition: 'all 0.2s',
                                }}
                                onClick={onConfirmDelete}
                            >
                                Just Delete
                            </button>
                        </div>
                        <div style={{ textAlign: 'right', paddingTop: '0.5rem' }}>
                            <button
                                type="button"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--muted)',
                                    cursor: 'pointer',
                                    padding: '0.5rem 1rem',
                                    fontSize: '0.95rem',
                                }}
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {step === 'sell_details' && (
                    <form className="modalBody" onSubmit={handleSoldSubmit}>
                        <p style={{ marginBottom: '1.5rem', lineHeight: 1.6, color: 'var(--muted)' }}>
                            Enter the sale details to update your cash balance.
                        </p>

                        <div className="field" style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                                Selling Price
                            </label>
                            <input
                                ref={firstInputRef}
                                value={priceStr}
                                onChange={(e) => setPriceStr(e.target.value)}
                                placeholder="0.00"
                                inputMode="decimal"
                                autoFocus
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="field" style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                                Amount Sold
                            </label>
                            <input
                                value={amountStr}
                                onChange={(e) => setAmountStr(e.target.value)}
                                placeholder="0"
                                inputMode="decimal"
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            margin: '1.5rem 0',
                            padding: '0.85rem 1rem',
                            background: 'color-mix(in oklab, var(--surface) 60%, transparent)',
                            borderRadius: '10px',
                            border: '1px solid var(--border)',
                        }}>
                            <span style={{ fontWeight: 600 }}>Total Proceeds:</span>
                            <span style={{
                                fontWeight: 700,
                                fontSize: '1.1rem',
                                color: 'var(--profit-pos)',
                                fontVariantNumeric: 'tabular-nums',
                            }}>
                                {total.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                            </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.5rem' }}>
                            <button
                                type="button"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--muted)',
                                    cursor: 'pointer',
                                    padding: '0.5rem 1rem',
                                    fontSize: '0.95rem',
                                }}
                                onClick={() => setStep('choice')}
                            >
                                Back
                            </button>
                            <button
                                type="submit"
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    borderRadius: '12px',
                                    fontWeight: 600,
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    border: '1px solid var(--accent)',
                                    background: 'var(--accent)',
                                    color: '#fff',
                                }}
                            >
                                Confirm Sale
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
