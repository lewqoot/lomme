import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRightLeft, ChevronLeft, ReceiptText, ScanSearch, Search, X } from 'lucide-react'
import { format, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { AppSnapshot, TransactionView } from '../../shared/contracts'
import { tint } from '../../lib/palette'
import { searchTransactions } from './model'
import { DATA_COLORS } from '../../shared/design-tokens'

type Props = {
  data: AppSnapshot
  glyph(icon?: string): ReactNode
  onEdit(transaction: TransactionView): void
  readOnly?: boolean
  onClose(): void
  /** Search runs over the loaded window, so the screen has to name it. */
  periodLabel: string
}

export function SearchPage({ data, glyph, onEdit, onClose, periodLabel, readOnly = false }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  const results = useMemo(() => searchTransactions(data.transactions, data.categories, query), [data.categories, data.transactions, query])
  const grouped = useMemo(() => {
    const map = new Map<string, TransactionView[]>()
    for (const item of results) {
      const key = format(parseISO(item.occurredAt), 'yyyy-MM-dd')
      map.set(key, [...(map.get(key) || []), item])
    }
    return [...map.entries()]
  }, [results])
  const categories = new Map(data.categories.map((item) => [item.id, item]))
  const hasQuery = query.trim().length > 0

  return <div className="search-screen">
    <header className="search-page-header">
      <button className="close-orb" type="button" onClick={onClose} aria-label="Назад"><ChevronLeft /></button>
      <h1>Поиск</h1>
      <span />
    </header>
    <p className="search-period-note">Ищем в периоде: {periodLabel}</p>

    {!hasQuery && <SearchState icon={<ScanSearch />} text="Ищите по названию счёта, названию категории, заметке, сумме, типу операции или периоду повтора, например еженедельно или ежемесячно." />}
    {hasQuery && !results.length && <SearchState icon={<ReceiptText />} title="Ничего не найдено" text="Проверьте запрос или попробуйте другую дату." />}
    {hasQuery && results.length > 0 && <section className="search-results" aria-live="polite">
      <p className="search-result-count">{results.length} {plural(results.length, 'операция', 'операции', 'операций')}</p>
      {grouped.map(([date, items]) => <div className="search-day" key={date}>
        <h2>{dayTitle(parseISO(date))}{isSameDay(parseISO(date), new Date()) ? ' — Сегодня' : ''}</h2>
        <div className="operation-list">{items.map((item) => {
          const category = categories.get(item.categoryId || '')
          return <button className="operation-row search-operation-row" type="button" key={item.id} disabled={readOnly} onClick={() => onEdit(item)}>
            <span className="category-icon" style={tileStyle(category?.color)}>{item.type === 'transfer' ? <ArrowRightLeft /> : glyph(category?.icon)}</span>
            <span className="operation-copy"><strong>{category?.name || (item.type === 'transfer' ? 'Перевод' : 'Без категории')}</strong>{item.note && <small>{item.note}</small>}</span>
            <strong className={item.type}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{money(item.amountKopecks)}</strong>
          </button>
        })}</div>
      </div>)}
    </section>}
    <label className="operation-search-field">
      <Search />
      <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск операций" />
      {hasQuery && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X /></button>}
    </label>
  </div>
}

function SearchState({ icon, title, text }: { icon: ReactNode; title?: string; text: string }) {
  return <div className="search-empty"><span>{icon}</span>{title && <strong>{title}</strong>}<p>{text}</p></div>
}

const money = (kopecks: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`
const tileStyle = (color?: string): CSSProperties => ({ background: tint(color), color: color || DATA_COLORS.glyphFallback })
const dayTitle = (date: Date) => {
  const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  return `${weekdays[date.getDay()]}, ${format(date, 'd MMMM', { locale: ru })}`
}
const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
