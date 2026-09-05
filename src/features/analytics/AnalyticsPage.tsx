import { lazy, Suspense, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChartColumnBig, ChartLine, ChartPie, ChevronLeft, SquareArrowUp, Waypoints } from 'lucide-react'
import { MenuItem } from '../../components/AnchoredMenu'
import { useAnchoredMenu } from '../../components/useAnchoredMenu'
import { PeriodPill } from '../period/PeriodPill'
import type { PeriodSelection } from '../period/model'
import { haptics } from '../../lib/telegram'
import { tint } from '../../lib/palette'
import type { AppSnapshot } from '../../shared/contracts'
import { buildFilteredTrend, buildSlices, CHART_KINDS, type AnalyticsType, type ChartKind } from './model'

const AnalyticsChart = lazy(() => import('../../charts/AnalyticsChart'))

const money = (kopecks: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(kopecks / 100)} ₽`

const CHART_ICON: Record<ChartKind, ReactNode> = {
  donut: <ChartPie />, line: <ChartLine />, bars: <ChartColumnBig />, sankey: <Waypoints />,
}

export function AnalyticsPage({ data, period, setPeriod, onClose, glyph, onShare }: {
  data: AppSnapshot
  period: PeriodSelection
  setPeriod(next: PeriodSelection): void
  onClose(): void
  glyph(icon: string | null | undefined): ReactNode
  onShare(text: string): void
}) {
  const [type, setType] = useState<AnalyticsType>('expense')
  const [kind, setKind] = useState<ChartKind>('donut')
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const chartAnchor = useRef<HTMLDivElement>(null)
  const chartMenu = useAnchoredMenu(chartAnchor)

  const { slices, visible, totalKopecks, grandTotalKopecks, allIncluded } = useMemo(
    () => buildSlices(data.summary, type, excluded), [data.summary, type, excluded])
  // Sankey needs both directions at once: sources on the left, spending on the right.
  const income = useMemo(() => buildSlices(data.summary, 'income', excluded), [data.summary, excluded])
  const expense = useMemo(() => buildSlices(data.summary, 'expense', excluded), [data.summary, excluded])
  const trend = useMemo(() => buildFilteredTrend(data.summary, type, excluded), [data.summary, type, excluded])

  const toggle = (key: string) => {
    haptics.selection()
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const toggleAll = () => {
    haptics.selection()
    setExcluded((current) => {
      const next = new Set(current)
      if (allIncluded) for (const item of slices) next.add(item.key)
      else for (const item of slices) next.delete(item.key)
      return next
    })
  }

  // Sankey shows both directions at once, so its own type segment would be a lie.
  const showsBothDirections = kind === 'sankey'
  const empty = slices.length === 0
  const account = data.activeAccountId
    ? data.accounts.find((item) => item.id === data.activeAccountId)
    : undefined
  const dataMotionKey = [
    kind,
    type,
    period.mode,
    period.anchor,
    period.mode === 'custom' ? period.start : '',
    period.mode === 'custom' ? period.end : '',
    [...excluded].sort().join(','),
  ].join(':')

  const share = () => {
    const lines = visible.map((item) => `${item.name}: ${money(item.amountKopecks)}`)
    onShare([`${type === 'income' ? 'Доходы' : 'Расходы'}: ${money(totalKopecks)}`, ...lines].join('\n'))
  }

  return <div className="analytics-screen">
    <header className="analytics-top">
      <button className="close-orb" type="button" onClick={onClose} aria-label="Назад"><ChevronLeft /></button>
      <div className="account-pill static"><span className="account-icon">{glyph(account?.icon)}</span><span><strong>{account?.name}</strong><small>{money(account?.balanceKopecks || 0)}</small></span></div>
      <div className="analytics-tools" ref={chartAnchor}>
        <button type="button" aria-label="Тип диаграммы" aria-haspopup="menu" aria-expanded={chartMenu.open} onClick={() => { haptics.selection(); chartMenu.toggle() }}>{CHART_ICON[kind]}</button>
        <button type="button" aria-label="Поделиться" onClick={share}><SquareArrowUp /></button>
        {chartMenu.render(CHART_KINDS.map((item) => <MenuItem key={item.kind} checked={item.kind === kind} onSelect={() => { haptics.selection(); chartMenu.close(); setKind(item.kind) }}>{item.label}</MenuItem>))}
      </div>
    </header>

    <div className="analytics-filters">
      {!showsBothDirections && <div className="type-chip">
        <button type="button" className={type === 'income' ? 'active income' : 'income'} aria-label="Доходы" onClick={() => { haptics.selection(); setType('income') }}><ArrowDownLeft /><span>Доход</span></button>
        <button type="button" className={type === 'expense' ? 'active expense' : 'expense'} aria-label="Расходы" onClick={() => { haptics.selection(); setType('expense') }}><ArrowUpRight /><span>Расход</span></button>
      </div>}
      <PeriodPill value={period} onChange={setPeriod} />
    </div>

    <div className="analytics-data" key={dataMotionKey}>
      {empty
        ? <p className="analytics-empty">Нет данных за выбранный период</p>
        : <>
          <div className="analytics-visual">
            <Suspense fallback={<div className="analytics-chart-placeholder skeleton" />}>
              <AnalyticsChart
                kind={kind}
                slices={visible}
                incomeSlices={income.visible}
                expenseSlices={expense.visible}
                totalKopecks={totalKopecks}
                trend={trend}
                granularity={data.summary.granularity}
                tone={type}
                incomeKopecks={income.totalKopecks}
                expenseKopecks={expense.totalKopecks}
              />
            </Suspense>
          </div>

          {showsBothDirections
            ? <div className="analytics-totals"><span className="income"><ArrowDownLeft />{money(income.totalKopecks)}</span><span className="expense"><ArrowUpRight />{money(expense.totalKopecks)}</span></div>
            : kind !== 'donut' && <div className="analytics-totals"><span className={type}>{type === 'income' ? <ArrowDownLeft /> : <ArrowUpRight />}{money(totalKopecks)}</span></div>}

          <div className="analytics-list">
            <button type="button" className="analytics-all" onClick={toggleAll}>
              <strong>Все категории</strong>
              <span>{money(totalKopecks)}</span>
              <Tick on={allIncluded} />
            </button>
            {slices.map((item) => <button
              type="button"
              key={item.key}
              className={item.included ? undefined : 'muted'}
              onClick={() => toggle(item.key)}
            >
              <span className="analytics-bar" style={{ ...barStyle(item.color), '--bar': item.amountKopecks / Math.max(1, grandTotalKopecks) } as CSSProperties}>
                {/* The label rides on top of the bar rather than inside it: the bar is
                    free to be narrower than its own name, which is what a 50 ₽ row
                    looks like in the reference. */}
                <span className="analytics-bar-label">{glyph(item.icon)}{item.name}</span>
              </span>
              <span>{money(item.amountKopecks)}</span>
              <Tick on={item.included} />
            </button>)}
          </div>
        </>}
    </div>
  </div>
}

const barStyle = (color: string) => ({ color, background: tint(color) })

/** Filled when the row counts towards the total, hollow when it is excluded. */
function Tick({ on }: { on: boolean }) {
  return <i className={`analytics-tick${on ? ' on' : ''}`} aria-hidden="true">
    {on && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
  </i>
}
