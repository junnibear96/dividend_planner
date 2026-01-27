
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
                    background: var(--surface-card, #ffffff);
                    color: var(--text-primary, #111111);
                    padding: 32px;
                    border-radius: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 28px;
                    max-width: 440px;
                    width: 100%;
                    margin: 20px auto;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.12);
                    border: 1px solid rgba(0,0,0,0.05);
                }

                .headerSection {
                    margin-bottom: 8px;
                }
                .headerLine {
                    font-size: 26px;
                    font-weight: 800;
                    line-height: 1.25;
                    letter-spacing: -0.02em;
                }
                .text-accent { color: var(--primary-color, #FFD700); }
                .text-white { color: var(--text-primary, #111); }
                .text-gray { color: var(--text-tertiary, #888); font-weight: 600; font-size: 22px; }

                .inputGroup label {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-secondary, #666);
                    margin-bottom: 10px;
                }

                .stockInput {
                    width: 100%;
                    background: var(--bg-secondary, #f5f5f7);
                    border: 1px solid transparent;
                    padding: 16px;
                    border-radius: 14px;
                    color: var(--text-primary, #111);
                    font-size: 17px;
                    font-weight: 500;
                    outline: none;
                    transition: all 0.2s;
                }
                .stockInput:focus {
                    background: #fff;
                    border-color: var(--primary-color, #FFD700);
                    box-shadow: 0 0 0 3px rgba(255, 215, 0, 0.2);
                }

                .segmentControl {
                    display: flex;
                    background: var(--bg-secondary, #f5f5f7);
                    padding: 4px;
                    border-radius: 12px;
                }
                .segmentBtn {
                    flex: 1;
                    padding: 10px;
                    background: transparent;
                    border: none;
                    color: var(--text-secondary, #666);
                    cursor: pointer;
                    border-radius: 9px;
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
                }
                .segmentBtn:hover {
                    color: var(--text-primary, #111);
                }
                .segmentBtn.active {
                    background: #fff;
                    color: #000;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                }

                .amountSection {
                    background: transparent;
                    padding: 10px 0;
                    text-align: center;
                }
                .amountInputWrapper {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 24px;
                    position: relative;
                }
                .amountInput {
                    background: transparent;
                    border: none;
                    color: var(--text-primary, #111);
                    font-size: 42px;
                    font-weight: 800;
                    text-align: center;
                    width: 200px;
                    outline: none;
                    padding: 0;
                    margin: 0 4px;
                }
                .amountInput::placeholder {
                    color: #ddd;
                }
                .currencyPrefix, .currencySuffix {
                    font-size: 24px;
                    font-weight: 600;
                    color: var(--text-secondary, #888);
                    margin-top: 8px;
                }
                .currencyToggle {
                    position: absolute;
                    right: 0;
                    top: 50%;
                    transform: translateY(-50%);
                    background: var(--bg-secondary, #f5f5f7);
                    border: none;
                    color: var(--text-secondary, #666);
                    font-size: 11px;
                    font-weight: 700;
                    padding: 6px 10px;
                    border-radius: 20px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .currencyToggle:hover {
                    background: #e5e5e7;
                    color: #111;
                }

                .quickChips {
                    display: flex;
                    gap: 8px;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                .chip {
                    background: #fff;
                    border: 1px solid var(--border-color, #eee);
                    color: var(--text-primary, #111);
                    padding: 8px 16px;
                    border-radius: 24px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    transition: all 0.1s;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                }
                .chip:hover {
                    background: var(--bg-secondary, #f5f5f7);
                    transform: translateY(-1px);
                    box-shadow: 0 3px 6px rgba(0,0,0,0.06);
                }
                .chip:active {
                    transform: translateY(0);
                }

                .errorMsg {
                    background: #FEF2F2;
                    color: #DC2626;
                    padding: 12px;
                    border-radius: 8px;
                    text-align: center;
                    font-size: 14px;
                    font-weight: 500;
                    animation: fadeIn 0.2s;
                }

                .actionFooter {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 8px;
                }
                .submitBtn {
                    background: var(--primary-color, #FFD700);
                    color: #000;
                    border: none;
                    padding: 18px;
                    border-radius: 16px;
                    font-size: 17px;
                    font-weight: 700;
                    cursor: pointer;
                    width: 100%;
                    transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
                }
                .submitBtn:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(255, 215, 0, 0.4);
                    filter: brightness(1.05);
                }
                .submitBtn:active {
                    transform: translateY(0);
                }
                .submitBtn:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }

                .cancelBtn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary, #666);
                    cursor: pointer;
                    font-size: 15px;
                    font-weight: 500;
                    padding: 10px;
                    transition: color 0.1s;
                }
                .cancelBtn:hover {
                    color: #111;
                    text-decoration: underline;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </form>
    )
}
