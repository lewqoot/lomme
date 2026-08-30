import type { CategoryView } from '../../shared/contracts'

type CategoryType = CategoryView['type']

/** The one ordering categories are shown in, wherever they are listed. */
export function ordered(categories: CategoryView[], type: CategoryType) {
  return categories.filter((item) => item.type === type && !item.archivedAt)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
}

/**
 * The order categories are offered in while entering an operation: what you reach
 * for most comes first. Ties fall back to the manual order, so an untouched ledger
 * still matches the manager.
 */
export function byUsage(
  categories: CategoryView[],
  type: CategoryType,
  transactions: ReadonlyArray<{ categoryId: string | null; type: string }>,
) {
  const uses = new Map<string, number>()
  for (const item of transactions) {
    if (item.type !== type || !item.categoryId) continue
    uses.set(item.categoryId, (uses.get(item.categoryId) ?? 0) + 1)
  }
  return ordered(categories, type)
    .map((item, index) => ({ item, index, uses: item.usageCount ?? uses.get(item.id) ?? 0 }))
    .sort((left, right) => right.uses - left.uses || left.index - right.index)
    .map((entry) => entry.item)
}
