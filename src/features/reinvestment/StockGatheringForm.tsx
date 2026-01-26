
import { useState, useMemo } from 'react'

import {
    createCollectionPlan,
    type CollectionPlanFrequency,
    type InvestmentType,
    type Currency
} from './reinvestmentApi'

type Props = {
    onSuccess: () => void
    onCancel: () => void
}

export default function StockGatheringForm({ onSuccess, onCancel }: Props) {
    // Form State
    const [targetStock, setTargetStock] = useState('')
    const [frequency, setFrequency] = useState<CollectionPlanFrequency>('daily')
    const [investmentType, setInvestmentType] = useState<InvestmentType>('AMOUNT')
    const [currency, setCurrency] = useState<Currency>('USD')
    const [amount, setAmount] = useState<string>('')
    const [autoDeposit] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Dynamic Header Logic
    const summaryText = useMemo(() => {
        const stock = targetStock ? targetStock.toUpperCase() : '___'
        const freqLabel = {
            daily: '매일', // 'Every Day'
            weekly: '매주', // 'Every Week'
            monthly: '매월' // 'Every Month'
        }[frequency]

        const amtVal = parseFloat(amount)
        const displayAmount = isNaN(amtVal) ? '0' : amtVal.toLocaleString()

        return {
            line1: `${stock} / ${freqLabel}`,
            line2: investmentType === 'AMOUNT'
                ? `${currency === 'USD' ? '$' : ''}${displayAmount}${currency === 'KRW' ? '원' : ''}씩`
                : `${displayAmount}주씩`,
            line3: '모을까요?' // 'Shall we gather?'
        }
    }, [targetStock, frequency, investmentType, currency, amount])

    const handleQuickAdd = (val: number) => {
        const current = parseFloat(amount) || 0
        setAmount((current + val).toString())
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        const amtVal = parseFloat(amount)

        if (!targetStock) {
            setError('종목을 입력해주세요.') // Please enter a stock
            return
        }
        if (isNaN(amtVal) || amtVal <= 0) {
            setError('올바른 금액/수량을 입력해주세요.') // Please enter valid amount
            return
        }

        setIsSubmitting(true)
        try {
            await createCollectionPlan({
                targetStock: targetStock.toUpperCase(),
                frequency,
                investmentType,
                currency,
                amount: amtVal,
                autoDeposit,
                startDate: new Date().toISOString().split('T')[0]
            })
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create plan')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <form className="gatheringForm" onSubmit={handleSubmit}>
            {/* 1. Dynamic Header */}
            <div className="headerSection">
                <div className="headerLine text-accent">{summaryText.line1}</div>
                <div className="headerLine text-white">{summaryText.line2}</div>
                <div className="headerLine text-gray">{summaryText.line3}</div>
            </div>

            {/* 2. Stock Input (Hidden if just showing summary, but generally needed to start) */}
            <div className="inputGroup">
                <label>어떤 주식을 모을까요?</label> {/* Which stock? */}
                <input
                    type="text"
                    placeholder="예: AAPL, TSLA"
                    value={targetStock}
                    onChange={e => setTargetStock(e.target.value)}
                    className="stockInput"
                    autoFocus
                />
            </div>

            {/* 3. Frequency Segment */}
            <div className="inputGroup">
                <label>얼마나 자주?</label> {/* How often? */}
                <div className="segmentControl">
                    {(['daily', 'weekly', 'monthly'] as const).map(f => (
                        <button
                            key={f}
                            type="button"
                            className={`segmentBtn ${frequency === f ? 'active' : ''}`}
                            onClick={() => setFrequency(f)}
                        >
                            {f === 'daily' ? '매일' : f === 'weekly' ? '매주' : '매월'}
                        </button>
                    ))}
                </div>
            </div>

            {/* 4. Type & Currency Segment */}
            <div className="inputGroup">
                <label>어떻게?</label> {/* How? */}
                <div className="segmentControl">
                    <button
                        type="button"
                        className={`segmentBtn ${investmentType === 'AMOUNT' ? 'active' : ''}`}
                        onClick={() => setInvestmentType('AMOUNT')}
                    >
                        금액으로 {/* By Amount */}
                    </button>
                    <button
                        type="button"
                        className={`segmentBtn ${investmentType === 'QUANTITY' ? 'active' : ''}`}
                        onClick={() => setInvestmentType('QUANTITY')}
                    >
                        수량으로 {/* By Quantity */}
                    </button>
                </div>
            </div>

            {/* 5. Amount Input & Quick Chips */}
            <div className="amountSection">
                <div className="amountInputWrapper">
                    <span className="currencyPrefix">
                        {investmentType === 'AMOUNT' && currency === 'USD' ? '$' : ''}
                    </span>
                    <input
                        type="number"
                        className="amountInput"
                        placeholder="0"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                    />
                    <span className="currencySuffix">
                        {investmentType === 'AMOUNT' && currency === 'KRW' ? '원' : ''}
                        {investmentType === 'QUANTITY' ? '주' : ''}
                    </span>

                    {/* Currency Toggle (only if Amount) */}
                    {investmentType === 'AMOUNT' && (
                        <button
                            type="button"
                            className="currencyToggle"
                            onClick={() => setCurrency(c => c === 'USD' ? 'KRW' : 'USD')}
                        >
                            {currency} ⇄
                        </button>
                    )}
                </div>

                <div className="quickChips">
                    {[1, 10, 50, 100].map(val => (
                        <button
                            key={val}
                            type="button"
                            className="chip"
                            onClick={() => handleQuickAdd(val)}
                        >
                            +{investmentType === 'AMOUNT' && currency === 'USD' ? '$' : ''}{val}
                        </button>
                    ))}
                </div>
            </div>

            {/* Error & Actions */}
            {error && <div className="errorMsg">{error}</div>}

            <div className="actionFooter">
                <button type="submit" className="submitBtn" disabled={isSubmitting}>
                    {isSubmitting ? '저장 중...' : '모으기'} {/* Gather */}
                </button>
                <button type="button" className="cancelBtn" onClick={onCancel}>
                    취소 {/* Cancel */}
                </button>
            </div>

            <style>{`
                .gatheringForm {
                    background: var(--surface-card);
                    color: var(--text-primary);
                    padding: 24px;
                    border-radius: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 24px;
                    max-width: 480px;
                    margin: 0 auto;
                    box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.5));
                    border: 1px solid var(--border-color);
                }

                .headerSection {
                    margin-bottom: 12px;
                }
                .headerLine {
                    font-size: 24px;
                    font-weight: 700;
                    line-height: 1.3;
                }
                .text-accent { color: var(--primary-color); }
                .text-white { color: var(--text-primary); }
                .text-gray { color: var(--text-secondary); }

                .inputGroup label {
                    display: block;
                    font-size: 14px;
                    color: var(--text-secondary);
                    margin-bottom: 8px;
                }

                .stockInput {
                    width: 100%;
                    background: var(--background-color);
                    border: 1px solid var(--border-color);
                    padding: 12px;
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 16px;
                    outline: none;
                }
                .stockInput:focus {
                    border-color: var(--primary-color);
                }

                .segmentControl {
                    display: flex;
                    background: var(--background-color);
                    padding: 4px;
                    border-radius: 8px;
                    border: 1px solid var(--border-color);
                }
                .segmentBtn {
                    flex: 1;
                    padding: 10px;
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    border-radius: 6px;
                    font-weight: 600;
                    transition: all 0.2s;
                }
                .segmentBtn.active {
                    background: var(--surface-hover);
                    color: var(--text-primary);
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }

                .amountSection {
                    background: var(--background-color);
                    padding: 20px;
                    border-radius: 12px;
                    border: 1px solid var(--border-color);
                }
                .amountInputWrapper {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 16px;
                    position: relative;
                }
                .amountInput {
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    font-size: 32px;
                    font-weight: 800;
                    text-align: center;
                    width: 150px;
                    outline: none;
                }
                .currencyPrefix, .currencySuffix {
                    font-size: 24px;
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .currencyToggle {
                    position: absolute;
                    right: 0;
                    background: var(--surface-hover);
                    border: none;
                    color: var(--primary-color);
                    font-size: 12px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                }

                .quickChips {
                    display: flex;
                    gap: 8px;
                    justify-content: center;
                }
                .chip {
                    background: var(--surface-hover);
                    border: 1px solid var(--border-color);
                    color: var(--text-primary);
                    padding: 6px 12px;
                    border-radius: 20px;
                    cursor: pointer;
                    font-size: 13px;
                }
                .chip:hover {
                    background: var(--border-color);
                }

                .actionFooter {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 12px;
                }
                .submitBtn {
                    background: var(--primary-color);
                    color: black; /* Keep black text on primary for contrast if primary is yellow */
                    border: none;
                    padding: 16px;
                    border-radius: 12px;
                    font-size: 18px;
                    font-weight: 800;
                    cursor: pointer;
                    width: 100%;
                }
                .submitBtn:hover {
                    opacity: 0.9;
                }
                .cancelBtn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    font-size: 14px;
                }
                .errorMsg {
                    color: var(--error-color, #ef4444);
                    text-align: center;
                    font-size: 14px;
                }
            `}</style>
        </form>
    )
}
