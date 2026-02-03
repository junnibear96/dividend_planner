
import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

type ExecutionItem = {
    symbol: string
    shares: number
    price: number // Estimated price, needed for cost calculation
}

type Props = {
    isOpen: boolean
    onClose: () => void
    onConfirm: (items: ExecutionItem[]) => void
    items: ExecutionItem[]
    isExecuting: boolean
}

export default function ExecutionConfirmationModal({ isOpen, onClose, onConfirm, items, isExecuting }: Props) {
    const { t } = useTranslation()
    const [editedItems, setEditedItems] = useState<ExecutionItem[]>([])

    useEffect(() => {
        if (isOpen) {
            setEditedItems(items.map(i => ({ ...i })))
        }
    }, [isOpen, items])

    if (!isOpen) return null

    const totalCost = editedItems.reduce((sum, item) => sum + (item.shares * item.price), 0)

    const handleShareChange = (index: number, val: string) => {
        const num = parseFloat(val)
        if (isNaN(num)) return
        const newItems = [...editedItems]
        newItems[index].shares = num
        setEditedItems(newItems)
    }

    const handlePriceChange = (index: number, val: string) => {
        const num = parseFloat(val)
        if (isNaN(num)) return
        const newItems = [...editedItems]
        newItems[index].price = num
        setEditedItems(newItems)
    }

    const handleRemove = (index: number) => {
        const newItems = [...editedItems]
        newItems.splice(index, 1)
        setEditedItems(newItems)
    }

    return (
        <div className="modalOverlay">
            <div className="modalContent">
                <h2>{t('reinvestment.execution.title')}</h2>
                <p>{t('reinvestment.execution.description')}</p>

                <div className="executionList" style={{ maxHeight: '300px', overflowY: 'auto', margin: '1rem 0' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left' }}>{t('common.symbol')}</th>
                                <th style={{ textAlign: 'right' }}>{t('common.shares')}</th>
                                <th style={{ textAlign: 'right' }}>{t('common.price')}</th>
                                <th style={{ textAlign: 'right' }}>{t('common.total')}</th>
                                <th style={{ width: '30px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {editedItems.map((item, idx) => (
                                <tr key={item.symbol + idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '0.5rem 0' }}>{item.symbol}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <input
                                            type="number"
                                            step="0.000001"
                                            value={item.shares}
                                            onChange={(e) => handleShareChange(idx, e.target.value)}
                                            style={{ width: '80px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={item.price}
                                            onChange={(e) => handlePriceChange(idx, e.target.value)}
                                            style={{ width: '80px', padding: '4px', textAlign: 'right' }}
                                        />
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        ${(item.shares * item.price).toFixed(2)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button
                                            onClick={() => handleRemove(idx)}
                                            style={{ color: 'var(--danger-color)', background: 'none', border: 'none', cursor: 'pointer' }}
                                            title={t('common.remove')}
                                        >
                                            ✕
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <div>
                        <strong>{t('reinvestment.execution.totalCost')}: </strong>
                        <span style={{ fontSize: '1.2em', color: 'var(--primary-color)' }}>${totalCost.toFixed(2)}</span>
                    </div>
                </div>

                <p style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                    {t('reinvestment.execution.warning')}
                </p>

                <div className="modalActions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} disabled={isExecuting} className="button secondary">
                        {t('common.cancel')}
                    </button>
                    <button onClick={() => onConfirm(editedItems)} disabled={isExecuting} className="button primary">
                        {isExecuting ? t('common.loading') : t('reinvestment.execution.confirm')}
                    </button>
                </div>
            </div>
        </div>
    )
}
