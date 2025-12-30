import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchReinvestmentHistory,
  fetchReinvestmentSummary,
  updateReinvestmentRule,
  type DestinationType,
  type ReinvestmentExecution,
  type ReinvestmentRule,
  type ReinvestmentSummary,
  type RuleDestinationAsset,
  type RuleFrequency,
  type ScheduleMode,
  type SourceScope,
} from './reinvestmentApi'
import type { WeekIndex } from './WeekTabs'

type ReinvestmentPanelProps = {
  activeWeek: WeekIndex
  onScheduleModeChange?: (mode: ScheduleMode) => void
  onActiveWeekChange?: (w: WeekIndex) => void
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function formatDateTime(raw: string | null): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) return raw
  return d.toLocaleString()
}

function normalizeRule(raw: ReinvestmentRule): ReinvestmentRule {
  const r: any = raw
  const scheduleMode: ScheduleMode = r.scheduleMode === 'WEEK_OF_MONTH' ? 'WEEK_OF_MONTH' : 'FIXED'
  const frequency: RuleFrequency =
    r.frequency === 'weekly' || r.frequency === 'biweekly' || r.frequency === 'monthly' ? r.frequency : 'monthly'
  const destinationType: DestinationType =
    r.destinationType === 'SAME_AS_SOURCE' || r.destinationType === 'SINGLE_ASSET' || r.destinationType === 'ALLOCATION_BASKET'
      ? r.destinationType
      : 'SAME_AS_SOURCE'
  const destinationAssets: RuleDestinationAsset[] = Array.isArray(r.destinationAssets) ? r.destinationAssets : []
  const weekDestinations = r.weekDestinations && typeof r.weekDestinations === 'object' ? r.weekDestinations : undefined

  return {
    ...raw,
    scheduleMode,
    frequency,
    destinationType,
    destinationAssets,
    weekDestinations,
  }
}

export default function ReinvestmentPanel(props: ReinvestmentPanelProps) {
  const [reinvestmentSummary, setReinvestmentSummary] = useState<ReinvestmentSummary | null>(null)
  const [reinvestmentSummaryError, setReinvestmentSummaryError] = useState<string | null>(null)
  const [reinvestmentHistory, setReinvestmentHistory] = useState<ReinvestmentExecution[]>([])
  const [reinvestmentHistoryError, setReinvestmentHistoryError] = useState<string | null>(null)
  const [isReinvestmentSummaryLoading, setIsReinvestmentSummaryLoading] = useState(false)
  const [isReinvestmentHistoryLoading, setIsReinvestmentHistoryLoading] = useState(false)

  const [draftRule, setDraftRule] = useState<ReinvestmentRule | null>(null)
  const [isRuleSaving, setIsRuleSaving] = useState(false)
  const editWeek = props.activeWeek

  const loadReinvestmentSummary = useCallback(async () => {
    try {
      setIsReinvestmentSummaryLoading(true)
      setReinvestmentSummaryError(null)
      const next = await fetchReinvestmentSummary()
      const normalized = normalizeRule(next.rule)
      setReinvestmentSummary(next)
      setDraftRule(normalized)
      props.onScheduleModeChange?.(normalized.scheduleMode)
    } catch (err) {
      setReinvestmentSummary(null)
      setDraftRule(null)
      setReinvestmentSummaryError(err instanceof Error ? err.message : 'Failed to load reinvestment summary')
    } finally {
      setIsReinvestmentSummaryLoading(false)
    }
  }, [props.onScheduleModeChange])

  const loadReinvestmentHistory = useCallback(async () => {
    try {
      setIsReinvestmentHistoryLoading(true)
      setReinvestmentHistoryError(null)
      const data = await fetchReinvestmentHistory(50)
      setReinvestmentHistory(Array.isArray(data.executions) ? data.executions : [])
    } catch (err) {
      setReinvestmentHistory([])
      setReinvestmentHistoryError(err instanceof Error ? err.message : 'Failed to load reinvestment history')
    } finally {
      setIsReinvestmentHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReinvestmentSummary()
    void loadReinvestmentHistory()
  }, [loadReinvestmentSummary, loadReinvestmentHistory])

  const historyRows = useMemo(() => {
    const rows: Array<{
      id: string
      executedAt: string
      weekIndex: number | null
      amount: number
      from: string
      to: string
      shares: number
      price: number
    }> = []

    for (const exec of reinvestmentHistory) {
      const fromSymbols = Array.isArray(exec.executionDetails?.sourceSymbols)
        ? exec.executionDetails.sourceSymbols.join(', ')
        : '—'
      const details = Array.isArray(exec.executionDetails?.details) ? exec.executionDetails.details : []
      if (details.length === 0) {
        rows.push({
          id: exec.id,
          executedAt: exec.executedAt,
          weekIndex: exec.weekIndex ?? null,
          amount: exec.totalAmount,
          from: fromSymbols,
          to: '—',
          shares: 0,
          price: 0,
        })
        continue
      }
      for (const d of details) {
        rows.push({
          id: `${exec.id}:${d.symbol}`,
          executedAt: exec.executedAt,
          weekIndex: exec.weekIndex ?? null,
          amount: d.spentAmount,
          from: fromSymbols,
          to: d.symbol,
          shares: d.sharesBought,
          price: d.price,
        })
      }
    }

    return rows
  }, [reinvestmentHistory])

  async function saveRule(rule: ReinvestmentRule) {
    try {
      setIsRuleSaving(true)
      await updateReinvestmentRule({
        enabled: rule.enabled,
        sourceScope: rule.sourceScope,
        destinationType: rule.destinationType,
        destinationAssets: rule.destinationAssets,
        scheduleMode: rule.scheduleMode,
        frequency: rule.frequency,
        weekDestinations: rule.weekDestinations,
        minimumAmount: rule.minimumAmount,
        fractionalSharesAllowed: rule.fractionalSharesAllowed,
      })
      await loadReinvestmentSummary()
      await loadReinvestmentHistory()
    } catch (err) {
      setReinvestmentSummaryError(err instanceof Error ? err.message : 'Failed to update reinvestment rule')
    } finally {
      setIsRuleSaving(false)
    }
  }

  const summaryCash = reinvestmentSummary ? formatMoney(reinvestmentSummary.dividendCashAvailable) : '—'
  const nextDate = reinvestmentSummary?.nextReinvestmentDate ?? '—'

  function effectiveDestinationForWeek(
    rule: ReinvestmentRule,
    week: WeekIndex,
  ): { destinationType: DestinationType; destinationAssets: RuleDestinationAsset[] } {
    if (rule.scheduleMode !== 'WEEK_OF_MONTH') {
      return { destinationType: rule.destinationType, destinationAssets: rule.destinationAssets }
    }
    const d = rule.weekDestinations?.[week]
    return d ?? { destinationType: rule.destinationType, destinationAssets: rule.destinationAssets }
  }

  function validateDestination(
    destination: { destinationType: DestinationType; destinationAssets: RuleDestinationAsset[] },
  ): string[] {
    const errors: string[] = []

    if (destination.destinationType === 'SINGLE_ASSET') {
      const symbol = (destination.destinationAssets[0]?.symbol ?? '').trim()
      if (!symbol) errors.push('Destination symbol is required.')
    }

    if (destination.destinationType === 'ALLOCATION_BASKET') {
      const assets = Array.isArray(destination.destinationAssets) ? destination.destinationAssets : []
      if (assets.length === 0) {
        errors.push('Destination basket must have at least 1 asset.')
        return errors
      }

      let totalWeight = 0
      for (const a of assets) {
        const symbol = (a.symbol ?? '').trim()
        if (!symbol) errors.push('Basket contains an empty symbol.')
        const w = Number(a.weight ?? 0)
        if (!Number.isFinite(w) || w <= 0) errors.push('Basket weights must be > 0.')
        if (Number.isFinite(w) && w > 0) totalWeight += w
      }
      if (totalWeight <= 0) errors.push('Basket total weight must be > 0.')
    }

    return Array.from(new Set(errors))
  }

  const validation = useMemo(() => {
    if (!draftRule) return { errors: [] as string[], activeWeekErrors: [] as string[] }

    const allErrors: string[] = []
    const active = effectiveDestinationForWeek(draftRule, editWeek)
    const activeWeekErrors = validateDestination(active)

    if (draftRule.scheduleMode === 'WEEK_OF_MONTH') {
      for (const w of [1, 2, 3, 4] as const) {
        const d = effectiveDestinationForWeek(draftRule, w)
        const errs = validateDestination(d)
        for (const e of errs) allErrors.push(`Week ${w}: ${e}`)
      }
    } else {
      for (const e of activeWeekErrors) allErrors.push(e)
    }

    return { errors: Array.from(new Set(allErrors)), activeWeekErrors }
  }, [draftRule, editWeek])

  const canSave = Boolean(draftRule) && !isRuleSaving && validation.errors.length === 0

  function formatDestinationShort(d: { destinationType: DestinationType; destinationAssets: RuleDestinationAsset[] }): string {
    if (d.destinationType === 'SAME_AS_SOURCE') return 'Same as source'
    if (d.destinationType === 'SINGLE_ASSET') return (d.destinationAssets[0]?.symbol ?? '—') || '—'
    const assets = Array.isArray(d.destinationAssets) ? d.destinationAssets : []
    if (assets.length === 0) return '—'
    const parts = assets
      .filter((a) => (a.symbol ?? '').trim())
      .slice(0, 2)
      .map((a) => {
        const w = Number(a.weight ?? 0)
        const pct = Number.isFinite(w) ? w : 0
        return `${a.symbol}${pct > 0 ? ` (${pct})` : ''}`
      })
    const more = assets.filter((a) => (a.symbol ?? '').trim()).length > 2 ? ' +…' : ''
    return parts.length ? `${parts.join(' / ')}${more}` : '—'
  }

  return (
    <div className="stack">
      {reinvestmentSummaryError ? (
        <p className="error" role="alert" aria-live="polite">
          {reinvestmentSummaryError}
        </p>
      ) : null}

      <section className="panel" aria-label="Reinvestment summary">
        <h2>Reinvestment</h2>
        <div className="summary" style={{ marginTop: 8 }}>
          <div className="summaryCard">
            <div className="summaryKey">Dividend Cash Available</div>
            <div className="summaryValue">{summaryCash}</div>
          </div>
          <div className="summaryCard">
            <div className="summaryKey">Next Scheduled Reinvestment</div>
            <div className="summaryValue">{nextDate}</div>
          </div>
          <button type="button" onClick={() => { void loadReinvestmentSummary(); void loadReinvestmentHistory() }} disabled={isReinvestmentSummaryLoading}>
            Refresh
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Reinvestment settings</h2>
        {isReinvestmentSummaryLoading && !draftRule ? <p className="empty">Loading…</p> : null}
        {!draftRule ? null : (
          <form
            className="form modalForm"
            onSubmit={(e) => {
              e.preventDefault()
              if (!draftRule) return
              if (validation.errors.length > 0) return
              void saveRule(draftRule)
            }}
          >
            {draftRule.scheduleMode === 'WEEK_OF_MONTH' ? (
              <div className="weekPreviewRow" aria-label="Week destination preview">
                {([1, 2, 3, 4] as const).map((w) => {
                  const d = effectiveDestinationForWeek(draftRule, w)
                  const label = formatDestinationShort(d)
                  const active = w === editWeek
                  return (
                    <button
                      key={w}
                      type="button"
                      className={active ? 'weekPreviewCard weekPreviewCardActive' : 'weekPreviewCard'}
                      onClick={() => props.onActiveWeekChange?.(w)}
                      disabled={isRuleSaving}
                      aria-current={active ? 'true' : undefined}
                      title={label}
                    >
                      <div className="weekPreviewWeek">Week {w}</div>
                      <div className="weekPreviewValue">{label}</div>
                    </button>
                  )
                })}
              </div>
            ) : null}

            <label className="field checkboxField">
              <span>Enabled</span>
              <input
                type="checkbox"
                checked={draftRule.enabled}
                onChange={(e) =>
                  setDraftRule((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))
                }
                disabled={isRuleSaving}
              />
            </label>

            <label className="field">
              <span>Schedule mode</span>
              <select
                value={draftRule.scheduleMode}
                onChange={(e) => {
                  const v = e.target.value as ScheduleMode
                  props.onScheduleModeChange?.(v)
                  setDraftRule((prev) => {
                    if (!prev) return prev
                    if (v === 'WEEK_OF_MONTH') {
                      const base = { destinationType: prev.destinationType, destinationAssets: prev.destinationAssets }
                      const wd = prev.weekDestinations ?? ({ 1: base, 2: base, 3: base, 4: base } as any)
                      return { ...prev, scheduleMode: v, weekDestinations: wd }
                    }
                    return { ...prev, scheduleMode: v }
                  })
                }}
                disabled={isRuleSaving}
              >
                <option value="FIXED">Fixed schedule</option>
                <option value="WEEK_OF_MONTH">Week 1–4 (different destinations)</option>
              </select>
            </label>

            {draftRule.scheduleMode === 'FIXED' ? (
              <label className="field">
                <span>Schedule</span>
                <select
                  value={draftRule.frequency}
                  onChange={(e) => {
                    const v = e.target.value as RuleFrequency
                    setDraftRule((prev) => (prev ? { ...prev, frequency: v } : prev))
                  }}
                  disabled={isRuleSaving}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            ) : null}

            <label className="field">
              <span>Source</span>
              <select
                value={draftRule.sourceScope}
                onChange={(e) => {
                  const v = e.target.value as SourceScope
                  setDraftRule((prev) => (prev ? { ...prev, sourceScope: v } : prev))
                }}
                disabled={isRuleSaving}
              >
                <option value="ALL">All holdings</option>
                <option value="SELECTED">Selected holdings (checkboxes in holdings tables)</option>
              </select>
            </label>

            {(() => {
              const active =
                draftRule.scheduleMode === 'WEEK_OF_MONTH'
                  ? (draftRule.weekDestinations?.[editWeek] ?? {
                      destinationType: draftRule.destinationType,
                      destinationAssets: draftRule.destinationAssets,
                    })
                  : { destinationType: draftRule.destinationType, destinationAssets: draftRule.destinationAssets }

              function setActiveDestination(next: {
                destinationType: DestinationType
                destinationAssets: RuleDestinationAsset[]
              }) {
                setDraftRule((prev) => {
                  if (!prev) return prev
                  if (prev.scheduleMode === 'WEEK_OF_MONTH') {
                    const wd: any = { ...(prev.weekDestinations ?? {}) }
                    // Cascade changes forward: editing Week N applies to Week N..4.
                    for (const w of [1, 2, 3, 4] as const) {
                      if (w >= editWeek) wd[w] = next
                    }
                    return {
                      ...prev,
                      destinationType: next.destinationType,
                      destinationAssets: next.destinationAssets,
                      weekDestinations: wd,
                    }
                  }
                  return { ...prev, destinationType: next.destinationType, destinationAssets: next.destinationAssets }
                })
              }

              return (
                <>
                  <label className="field">
                    <span>Destination{draftRule.scheduleMode === 'WEEK_OF_MONTH' ? ` (Week ${editWeek})` : ''}</span>
                    <select
                      value={active.destinationType}
                      onChange={(e) => {
                        const v = e.target.value as DestinationType
                        const nextAssets: RuleDestinationAsset[] =
                          v === 'SINGLE_ASSET'
                            ? [{ symbol: active.destinationAssets[0]?.symbol ?? '' }]
                            : v === 'ALLOCATION_BASKET'
                              ? active.destinationAssets.length
                                ? active.destinationAssets
                                : [{ symbol: '', weight: 1 }]
                              : []
                        setActiveDestination({ destinationType: v, destinationAssets: nextAssets })
                      }}
                      disabled={isRuleSaving}
                    >
                      <option value="SAME_AS_SOURCE">Same as source</option>
                      <option value="SINGLE_ASSET">Single asset</option>
                      <option value="ALLOCATION_BASKET">Allocation basket</option>
                    </select>
                    {draftRule.scheduleMode === 'WEEK_OF_MONTH' ? (
                      <p className="hint">
                        Editing Week {editWeek} applies to {editWeek === 4 ? 'Week 4' : `Week ${editWeek}–4`}.
                      </p>
                    ) : null}
                    {validation.activeWeekErrors.length ? (
                      <p className="error" role="alert" aria-live="polite">
                        {validation.activeWeekErrors[0]}
                      </p>
                    ) : null}
                  </label>

                  {active.destinationType === 'SINGLE_ASSET' ? (
                    <label className="field">
                      <span>Destination symbol</span>
                      <input
                        value={active.destinationAssets[0]?.symbol ?? ''}
                        onChange={(e) => {
                          const nextSymbol = e.target.value.toUpperCase()
                          setActiveDestination({ destinationType: 'SINGLE_ASSET', destinationAssets: [{ symbol: nextSymbol }] })
                        }}
                        placeholder="e.g., SCHD.US"
                        disabled={isRuleSaving}
                      />
                    </label>
                  ) : null}

                  {active.destinationType === 'ALLOCATION_BASKET' ? (
                    <div className="field">
                      <div className="fieldLabelRow">
                        <span>Destination basket</span>
                        <button
                          type="button"
                          className="linkButton"
                          onClick={() => {
                            setActiveDestination({
                              destinationType: 'ALLOCATION_BASKET',
                              destinationAssets: [...active.destinationAssets, { symbol: '', weight: 1 }],
                            })
                          }}
                          disabled={isRuleSaving}
                        >
                          Add asset
                        </button>
                      </div>
                      <div className="tableWrap modalTableWrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Symbol</th>
                              <th className="num">Weight</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {active.destinationAssets.map((a, idx) => (
                              <tr key={`${idx}-${a.symbol}`}>
                                <td>
                                  <input
                                    value={a.symbol}
                                    onChange={(e) => {
                                      const nextSymbol = e.target.value.toUpperCase()
                                      const next = [...active.destinationAssets]
                                      next[idx] = { ...next[idx], symbol: nextSymbol }
                                      setActiveDestination({ destinationType: 'ALLOCATION_BASKET', destinationAssets: next })
                                    }}
                                    placeholder="e.g., VTI.US"
                                    disabled={isRuleSaving}
                                  />
                                </td>
                                <td className="num">
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={String(a.weight ?? '')}
                                    onChange={(e) => {
                                      const w = Number(e.target.value)
                                      const next = [...active.destinationAssets]
                                      next[idx] = { ...next[idx], weight: Number.isFinite(w) ? w : 0 }
                                      setActiveDestination({ destinationType: 'ALLOCATION_BASKET', destinationAssets: next })
                                    }}
                                    disabled={isRuleSaving}
                                  />
                                </td>
                                <td className="num">
                                  <button
                                    type="button"
                                    className="linkButton"
                                    onClick={() => {
                                      const next = active.destinationAssets.filter((_, i) => i !== idx)
                                      setActiveDestination({ destinationType: 'ALLOCATION_BASKET', destinationAssets: next })
                                    }}
                                    disabled={isRuleSaving || active.destinationAssets.length <= 1}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              )
            })()}

            <label className="field">
              <span>Minimum Amount (USD)</span>
              <input
                type="number"
                min={0}
                step="any"
                value={String(draftRule.minimumAmount)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setDraftRule((prev) =>
                    prev ? { ...prev, minimumAmount: Number.isFinite(v) ? v : prev.minimumAmount } : prev,
                  )
                }}
                disabled={isRuleSaving}
              />
            </label>

            <label className="field checkboxField">
              <span>Fractional shares allowed</span>
              <input
                type="checkbox"
                checked={draftRule.fractionalSharesAllowed}
                onChange={(e) =>
                  setDraftRule((prev) => (prev ? { ...prev, fractionalSharesAllowed: e.target.checked } : prev))
                }
                disabled={isRuleSaving}
              />
            </label>

            <div className="actions">
              <button type="submit" disabled={!canSave}>
                Save
              </button>
            </div>

            {validation.errors.length ? (
              <div className="error" role="alert" aria-live="polite">
                {draftRule.scheduleMode === 'WEEK_OF_MONTH'
                  ? `Fix Week 1–4 settings before saving. (${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'})`
                  : `Fix settings before saving. (${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'})`}
              </div>
            ) : null}
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Reinvestment history</h2>
        {isReinvestmentHistoryLoading ? (
          <p className="empty">Loading…</p>
        ) : reinvestmentHistoryError ? (
          <p className="error" role="alert" aria-live="polite">
            {reinvestmentHistoryError}
          </p>
        ) : historyRows.length === 0 ? (
          <p className="empty">No reinvestment history.</p>
        ) : (
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date/time</th>
                  <th className="num">Week</th>
                  <th className="num">Amount</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.executedAt)}</td>
                    <td className="num">{r.weekIndex ? `W${r.weekIndex}` : '—'}</td>
                    <td className="num">{formatMoney(r.amount)}</td>
                    <td className="mono">{r.from || '—'}</td>
                    <td className="mono">{r.to || '—'}</td>
                    <td className="num">{r.shares ? r.shares.toFixed(6) : '—'}</td>
                    <td className="num">{r.price ? formatMoney(r.price) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
