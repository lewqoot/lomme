import { format, isSameDay, parseISO, subDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { CategoryView, TransactionView } from '../../shared/contracts.js'

const normalize = (value: string) => value
  .toLocaleLowerCase('ru')
  .replaceAll('ё', 'е')
  .replace(/[\u00a0\u202f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const compact = (value: string) => normalize(value).replace(/[\s₽]/g, '')

export function searchTransactions(
  transactions: TransactionView[],
  categories: CategoryView[],
  query: string,
  today = new Date(),
) {
  const needle = normalize(query)
  const compactNeedle = compact(query)
  if (!needle) return []

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  return transactions.filter((transaction) => {
    const date = parseISO(transaction.occurredAt)
    const amount = transaction.amountKopecks / 100
    const amountText = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: transaction.amountKopecks % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount)
    const relative = isSameDay(date, today) ? 'сегодня' : isSameDay(date, subDays(today, 1)) ? 'вчера' : ''
    const category = categoryNames.get(transaction.categoryId || '')
      || (transaction.type === 'transfer' ? 'Перевод' : 'Без категории')
    const text = normalize([
      transaction.note,
      category,
      amountText,
      `${amountText} ₽`,
      format(date, 'd MMMM yyyy', { locale: ru }),
      format(date, 'd MMMM', { locale: ru }),
      format(date, 'EEEE', { locale: ru }),
      format(date, 'dd.MM.yyyy'),
      format(date, 'yyyy-MM-dd'),
      relative,
    ].join(' '))

    return text.includes(needle) || (compactNeedle.length > 0 && compact(amountText).includes(compactNeedle))
  })
}
