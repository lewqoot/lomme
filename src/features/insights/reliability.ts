export const MIN_INSIGHT_OBSERVATION_DAYS = 7

export function hasReliableInsightSample(observedDayCount: number) {
  return observedDayCount >= MIN_INSIGHT_OBSERVATION_DAYS
}

/** Never claim that all income was saved when a non-zero expense was recorded. */
export function savedIncomePercent(incomeKopecks: number, expenseKopecks: number, netKopecks: number) {
  if (incomeKopecks <= 0) return 0
  const upperBound = expenseKopecks > 0 ? 99 : 100
  return Math.min(upperBound, Math.max(0, Math.floor((netKopecks / incomeKopecks) * 100)))
}
