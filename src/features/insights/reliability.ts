export const MIN_INSIGHT_OBSERVATION_DAYS = 7
export const MIN_RUNWAY_OBSERVATION_DAYS = 30
export const MIN_RUNWAY_OPERATIONS = 10

export function hasReliableInsightSample(observedDayCount: number) {
  return observedDayCount >= MIN_INSIGHT_OBSERVATION_DAYS
}

export function hasReliableRunwaySample(observedDayCount: number, operationCount: number, expenseKopecks: number) {
  return observedDayCount >= MIN_RUNWAY_OBSERVATION_DAYS
    && operationCount >= MIN_RUNWAY_OPERATIONS
    && expenseKopecks > 0
}

/** Never claim that all income was saved when a non-zero expense was recorded. */
export function savedIncomePercent(incomeKopecks: number, expenseKopecks: number, netKopecks: number) {
  if (incomeKopecks <= 0) return 0
  const upperBound = expenseKopecks > 0 ? 99 : 100
  return Math.min(upperBound, Math.max(0, Math.floor((netKopecks / incomeKopecks) * 100)))
}
