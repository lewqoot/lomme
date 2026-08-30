import { describe, expect, it } from 'vitest'
import type { CategoryView, TransactionView } from '../src/shared/contracts.js'
import { searchTransactions } from '../src/features/search/model.js'

const categories: CategoryView[] = [
  { id: 'category-home', type: 'expense', name: 'Жилищные расходы', icon: 'house', color: '#6B6B6B', parentId: null, order: 0, version: 1, archivedAt: null },
]
const transactions: TransactionView[] = [
  { id: 'rent', type: 'expense', amountKopecks: 47_080_50, accountId: 'account', targetAccountId: null, categoryId: 'category-home', occurredAt: '2026-08-26T10:00:00.000Z', note: 'Аренда за август', source: 'manual', authorName: 'Алекс', version: 1 },
  { id: 'income', type: 'income', amountKopecks: 50_000_00, accountId: 'account', targetAccountId: null, categoryId: null, occurredAt: '2026-08-25T10:00:00.000Z', note: 'Аванс', source: 'manual', authorName: 'Алекс', version: 1 },
]
const today = new Date('2026-08-26T12:00:00.000Z')

describe('поиск операций', () => {
  it.each([
    ['аренда', ['rent']],
    ['жилищные', ['rent']],
    ['47 080,50', ['rent']],
    ['47080,5', ['rent']],
    ['26 августа', ['rent']],
    ['26.08.2026', ['rent']],
    ['сегодня', ['rent']],
    ['вчера', ['income']],
  ])('ищет по запросу %s', (query, ids) => {
    expect(searchTransactions(transactions, categories, query, today).map((item) => item.id)).toEqual(ids)
  })

  it('не возвращает весь журнал для пустой строки', () => {
    expect(searchTransactions(transactions, categories, '   ', today)).toEqual([])
  })
})
