import { endOfMonth, startOfMonth } from 'date-fns'
import type { CategoryView, DashboardSummary, TransactionView } from './contracts.js'
import { zonedDateKey, zonedDayNumber } from './timezone.js'
import { DATA_COLORS } from './design-tokens.js'

export function periodForMonth(date = new Date()) {
  return { start: startOfMonth(date), end: endOfMonth(date) }
}

/**
 * Aggregates for an arbitrary range. Every screen asks for the same window, so the
 * totals on home, insights and analytics cannot disagree.
 */
export function calculateSummary(
  transactions: TransactionView[],
  categories: CategoryView[],
  range: { start: Date; end: Date } = periodForMonth(),
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): DashboardSummary {
  const { start, end } = range
  // Buckets switch to months once the window is longer than the reference's chart
  // can legibly show as days.
  const byMonth = zonedDayNumber(end, timeZone) - zonedDayNumber(start, timeZone) > 62
  const bucketOf = (value: Date) => {
    const day = zonedDateKey(value, timeZone)
    return byMonth ? day.slice(0, 7) : day
  }
  const allPeriodTransactions = transactions.filter((transaction) => {
    const occurredAt = new Date(transaction.occurredAt)
    return occurredAt >= start && occurredAt <= end
  })
  const periodTransactions = allPeriodTransactions.filter((transaction) => transaction.type !== 'transfer')

  const incomeKopecks = periodTransactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amountKopecks, 0)
  const expenseKopecks = periodTransactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amountKopecks, 0)

  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  // Analytics needs both directions, so totals are keyed by type as well as category.
  const categoryTotals = new Map<string, number>()
  const categoryTrend = new Map<string, number>()
  const keyFor = (type: 'income' | 'expense', categoryId: string | null) => `${type}:${categoryId ?? ''}`
  const dayTotals = new Map<string, { incomeKopecks: number; expenseKopecks: number }>()
  // The chart may bucket by month, but "most expensive day" has to stay a day, so
  // spend per calendar day is tracked separately from the chart's buckets.
  const perDayExpense = new Map<string, number>()

  for (const transaction of periodTransactions) {
    const dateKey = bucketOf(new Date(transaction.occurredAt))
    const day = dayTotals.get(dateKey) || { incomeKopecks: 0, expenseKopecks: 0 }
    if (transaction.type === 'expense') day.expenseKopecks += transaction.amountKopecks
    else day.incomeKopecks += transaction.amountKopecks
    if (transaction.type === 'expense' || transaction.type === 'income') {
      const key = keyFor(transaction.type, transaction.categoryId)
      categoryTotals.set(key, (categoryTotals.get(key) || 0) + transaction.amountKopecks)
      const trendKey = `${dateKey}|${transaction.type}|${transaction.categoryId ?? ''}`
      categoryTrend.set(trendKey, (categoryTrend.get(trendKey) || 0) + transaction.amountKopecks)
    }
    dayTotals.set(dateKey, day)
    if (transaction.type === 'expense') {
      const dayKey = zonedDateKey(new Date(transaction.occurredAt), timeZone)
      perDayExpense.set(dayKey, (perDayExpense.get(dayKey) || 0) + transaction.amountKopecks)
    }
  }

  const cutoff = now < end ? now : end
  const elapsedDays = Math.max(1, zonedDayNumber(cutoff, timeZone) - zonedDayNumber(start, timeZone) + 1)
  const firstObservedDay = allPeriodTransactions
    .map((transaction) => zonedDayNumber(new Date(transaction.occurredAt), timeZone))
    .filter((day) => day <= zonedDayNumber(cutoff, timeZone))
    .reduce<number | null>((first, day) => first === null || day < first ? day : first, null)
  const observedDayCount = firstObservedDay === null
    ? 0
    : Math.max(0, zonedDayNumber(cutoff, timeZone) - firstObservedDay + 1)
  const expenses = periodTransactions.filter((transaction) => transaction.type === 'expense')
  const incomes = periodTransactions.filter((transaction) => transaction.type === 'income')
  const largestExpense = expenses.reduce<TransactionView | null>((best, item) =>
    !best || item.amountKopecks > best.amountKopecks ? item : best, null)
  const largestIncome = incomes.reduce<TransactionView | null>((best, item) =>
    !best || item.amountKopecks > best.amountKopecks ? item : best, null)
  const expenseCounts = new Map<string, number>()
  let weekendExpenseKopecks = 0
  const spentDayNumbers = new Set<number>()
  for (const expense of expenses) {
    const day = zonedDayNumber(new Date(expense.occurredAt), timeZone)
    spentDayNumbers.add(day)
    const weekday = ((day + 4) % 7 + 7) % 7
    if (weekday === 0 || weekday === 6) weekendExpenseKopecks += expense.amountKopecks
    const key = expense.categoryId ?? ''
    expenseCounts.set(key, (expenseCounts.get(key) ?? 0) + 1)
  }
  const [mostFrequentExpenseCategoryId = '', mostFrequentExpenseCategoryCount = 0] = [...expenseCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? []
  let expenseFreeStreakDays = 0
  let currentExpenseFreeStreakDays = 0
  const firstDay = firstObservedDay
  const lastDay = zonedDayNumber(cutoff, timeZone)
  if (firstDay !== null) {
    for (let day = firstDay; day <= lastDay; day += 1) {
      currentExpenseFreeStreakDays = spentDayNumbers.has(day) ? 0 : currentExpenseFreeStreakDays + 1
      expenseFreeStreakDays = Math.max(expenseFreeStreakDays, currentExpenseFreeStreakDays)
    }
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    granularity: byMonth ? 'month' : 'day',
    elapsedDays,
    observedDayCount,
    netKopecks: incomeKopecks - expenseKopecks,
    incomeKopecks,
    expenseKopecks,
    averageExpensePerDayKopecks: Math.round(expenseKopecks / elapsedDays),
    largestExpenseKopecks: largestExpense?.amountKopecks ?? 0,
    largestExpenseCategoryId: largestExpense?.categoryId ?? null,
    largestIncomeKopecks: largestIncome?.amountKopecks ?? 0,
    largestIncomeCategoryId: largestIncome?.categoryId ?? null,
    mostExpensiveDayKopecks: [...perDayExpense.values()].reduce((best, value) => Math.max(best, value), 0),
    mostExpensiveDay: [...perDayExpense.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
    expenseFreeStreakDays,
    weekendExpenseSharePercent: expenseKopecks ? Math.round((weekendExpenseKopecks / expenseKopecks) * 100) : 0,
    operationCount: allPeriodTransactions.length,
    mostFrequentExpenseCategoryId: mostFrequentExpenseCategoryId || null,
    mostFrequentExpenseCategoryCount,
    byCategory: [...categoryTotals.entries()]
      .map(([key, amountKopecks]) => {
        const [type, rawId] = key.split(':') as ['income' | 'expense', string]
        const categoryId = rawId || null
        const category = categoryId ? categoryMap.get(categoryId) : undefined
        return {
          categoryId,
          name: category?.name || 'Без категории',
          color: category?.color || DATA_COLORS.categoryFallback,
          icon: category?.icon ?? null,
          amountKopecks,
          type,
        }
      })
      .sort((left, right) => right.amountKopecks - left.amountKopecks),
    trend: [...dayTotals.entries()]
      .map(([day, totals]) => ({ date: day, ...totals }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    trendByCategory: [...categoryTrend.entries()]
      .map(([key, amountKopecks]) => {
        const [date, type, rawId] = key.split('|') as [string, 'income' | 'expense', string]
        return { date, type, categoryId: rawId || null, amountKopecks }
      })
      .sort((left, right) => left.date.localeCompare(right.date) || left.type.localeCompare(right.type) || String(left.categoryId).localeCompare(String(right.categoryId))),
  }
}
