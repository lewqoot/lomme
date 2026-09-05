import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowRightLeft, ChevronLeft, ReceiptText, ScanSearch, Search, X } from 'lucide-react'
import { format, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { AppSnapshot, TransactionPage, TransactionView } from '../../shared/contracts'
import { api } from '../../lib/api'
import { tint } from '../../lib/palette'
import { DATA_COLORS } from '../../shared/design-tokens'

type Props = {
  data: AppSnapshot
  glyph(icon?: string): ReactNode
  onEdit(transaction: TransactionView): void
  onClose(): void
  periodLabel: string
  periodStart: string
  periodEnd: string
}

export function SearchPage({ data, glyph, onEdit, onClose, periodLabel, periodStart, periodEnd }: Props) {
  const [query, setQuery] = useState('')
  const [settledQuery, setSettledQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const search = useInfiniteQuery({
    queryKey: ['transaction-search', data.activeWorkspaceId, data.activeAccountId, periodStart, periodEnd, settledQuery],
    enabled: settledQuery.length > 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        workspaceId: data.activeWorkspaceId,
        start: periodStart,
        end: periodEnd,
        query: settledQuery,
        limit: '20',
      })
      if (data.activeAccountId) params.set('accountId', data.activeAccountId)
      if (pageParam) params.set('cursor', pageParam)
      return api<TransactionPage>(`/transactions/search?${params}`)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  const results = useMemo(() => search.data?.pages.flatMap((page) => page.items) || [], [search.data])
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
  const waitingForQuery = hasQuery && query.trim() !== settledQuery

  return <div className="search-screen">
    <header className="search-page-header">
      <button className="close-orb" type="button" onClick={onClose} aria-label="Назад"><ChevronLeft /></button>
      <h1>Поиск</h1>
      <span />
    </header>
    <p className="search-period-note">Ищем в периоде: {periodLabel}</p>

    {!hasQuery && <SearchState icon={<ScanSearch />} text="Ищите по счёту, категории, заметке, сумме, типу или дате операции." />}
    {hasQuery && (waitingForQuery || search.isLoading) && <SearchState icon={<ScanSearch />} text="Ищем во всём выбранном периоде…" />}
    {hasQuery && !waitingForQuery && search.isError && <SearchState icon={<ReceiptText />} title="Поиск недоступен" text="Попробуйте ещё раз." />}
    {hasQuery && !waitingForQuery && search.isSuccess && !results.length && <SearchState icon={<ReceiptText />} title="Ничего не найдено" text="Проверьте запрос или измените выбранный период." />}
    {hasQuery && !waitingForQuery && results.length > 0 && <section className="search-results" aria-live="polite">
      <p className="search-result-count">Показано: {results.length} {plural(results.length, 'операция', 'операции', 'операций')}</p>
      {grouped.map(([date, items]) => <div className="search-day" key={date}>
        <h2>{dayTitle(parseISO(date))}{isSameDay(parseISO(date), new Date()) ? ' — Сегодня' : ''}</h2>
        <div className="operation-list">{items.map((item) => {
          const category = categories.get(item.categoryId || '')
          return <button className="operation-row search-operation-row" type="button" key={item.id} onClick={() => onEdit(item)}>
            <span className="category-icon" style={tileStyle(category?.color)}>{item.type === 'transfer' ? <ArrowRightLeft /> : glyph(category?.icon)}</span>
            <span className="operation-copy"><strong>{category?.name || (item.type === 'transfer' ? 'Перевод' : 'Без категории')}</strong>{item.note && <small>{item.note}</small>}</span>
            <strong className={item.type}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{money(item.amountKopecks)}</strong>
          </button>
      })}</div>
      </div>)}
      {search.hasNextPage && <div className="load-more-row"><button className="secondary-button" type="button" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>{search.isFetchingNextPage ? 'Загружаем' : 'Показать ещё'}</button></div>}
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
