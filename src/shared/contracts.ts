import { z } from 'zod'
import { DATA_COLORS } from './design-tokens.js'

export const moneySchema = z.number().int().nonnegative().max(999_999_999_99)
export const uuidSchema = z.string().uuid()
export const iconKeySchema = z.string().trim().min(1).max(32)
export const timeZoneSchema = z.string().trim().min(1).max(80).refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format()
    return true
  } catch {
    return false
  }
}, 'Укажите корректный часовой пояс')

export const transactionTypeSchema = z.enum(['expense', 'income', 'transfer'])
/** Daily reminder settings, as the notifications screen sends them. */
export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате 20:00'),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7),
})

export const transactionSourceSchema = z.enum(['manual', 'import', 'voice', 'receipt', 'shortcut', 'bot'])
export const transactionPageQuerySchema = z.object({
  workspaceId: uuidSchema,
  accountId: uuidSchema.optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const transactionBaseSchema = z.object({
  workspaceId: uuidSchema,
  type: transactionTypeSchema,
  amountKopecks: moneySchema.positive(),
  accountId: uuidSchema,
  targetAccountId: uuidSchema.nullish(),
  categoryId: uuidSchema.nullish(),
  occurredAt: z.string().datetime(),
  note: z.string().trim().max(500).default(''),
  source: transactionSourceSchema.default('manual'),
})

const validateTransaction = (
  value: { type: TransactionType; accountId: string; targetAccountId?: string | null; categoryId?: string | null },
  context: z.RefinementCtx,
) => {
  if (value.type === 'transfer' && !value.targetAccountId) {
    context.addIssue({ code: 'custom', path: ['targetAccountId'], message: 'Выберите счёт назначения' })
  }
  if (value.type === 'transfer' && value.targetAccountId === value.accountId) {
    context.addIssue({ code: 'custom', path: ['targetAccountId'], message: 'Счета перевода должны отличаться' })
  }
}

export const createTransactionSchema = transactionBaseSchema.superRefine(validateTransaction)

export const updateTransactionSchema = transactionBaseSchema
  .omit({ workspaceId: true, source: true })
  .extend({ version: z.number().int().positive() })
  .superRefine(validateTransaction)

export const createAccountSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['cash', 'card', 'savings', 'other']).default('cash'),
  icon: iconKeySchema.default('wallet'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DATA_COLORS.accountDefault),
  openingBalanceKopecks: z.number().int().min(-999_999_999_99).max(999_999_999_99).default(0),
})

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  version: z.number().int().positive(),
})

export const activeAccountSchema = z.object({
  workspaceId: uuidSchema,
  accountId: uuidSchema.nullable(),
})

export const accountInviteSchema = z.object({
  role: z.literal('editor').default('editor'),
})

export const inviteTokenSchema = z.object({
  token: z.string().trim().min(20).max(120),
})

export const createCategorySchema = z.object({
  workspaceId: uuidSchema,
  type: z.enum(['expense', 'income']),
  name: z.string().trim().min(1).max(80),
  icon: iconKeySchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  parentId: uuidSchema.nullish(),
  order: z.number().int().nonnegative().optional(),
})

export const updateCategorySchema = createCategorySchema
  .omit({ workspaceId: true, order: true })
  .extend({ version: z.number().int().positive() })

export const reorderCategoriesSchema = z.object({
  workspaceId: uuidSchema,
  type: z.enum(['expense', 'income']),
  categoryIds: z.array(uuidSchema).min(1).max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Категории не должны повторяться'),
})
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
})
export const authTelegramSchema = z.object({
  initData: z.string().default(''),
  timezone: timeZoneSchema.default('Europe/Moscow'),
})

/**
 * The first public Telegram build was a design preview which kept its ledger in
 * the browser. This is a deliberately narrow, one-way bridge for moving that
 * ledger to the authenticated server account. The original browser IDs are
 * retained only as idempotency keys; they are never stored as transaction IDs.
 */
export const legacyPreviewMigrationSchema = authTelegramSchema.extend({
  categories: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(['expense', 'income']),
    name: z.string().trim().min(1).max(80),
    icon: iconKeySchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })).max(500).default([]),
  entries: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(['expense', 'income']),
    amountKopecks: moneySchema.positive(),
    categoryId: z.string().trim().min(1).max(120).nullish(),
    occurredAt: z.string().datetime(),
    note: z.string().trim().max(500).default(''),
  })).max(1000).default([]),
  openingBalanceKopecks: z.number().int().min(-999_999_999_99).max(999_999_999_99).default(0),
})

export type TransactionType = z.infer<typeof transactionTypeSchema>
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>
export type CreateAccountInput = z.infer<typeof createAccountSchema>
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>
export type ActiveAccountInput = z.infer<typeof activeAccountSchema>
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>
export type WorkspaceSummary = {
  id: string
  name: string
  kind: 'personal' | 'family'
  role: 'owner' | 'member'
}

export type AccountView = {
  id: string
  workspaceId: string
  name: string
  kind: 'cash' | 'card' | 'savings' | 'other'
  icon: string
  color: string
  openingBalanceKopecks: number
  balanceKopecks: number
  version: number
  archivedAt: string | null
  accessRole: 'owner' | 'editor'
  memberCount: number
}

export type CategoryView = {
  id: string
  type: 'expense' | 'income'
  name: string
  icon: string
  color: string
  parentId: string | null
  order: number
  version: number
  archivedAt: string | null
  /** Whole-ledger usage supplied by the server so cursor paging cannot reorder the picker. */
  usageCount?: number
}
export type TransactionView = {
  id: string
  type: TransactionType
  amountKopecks: number
  accountId: string
  targetAccountId: string | null
  categoryId: string | null
  occurredAt: string
  note: string
  source: z.infer<typeof transactionSourceSchema>
  /** Category was matched from text rather than chosen; the app asks to confirm. */
  categoryGuessed?: boolean
  authorName: string
  version: number
}

export type TransactionPage = {
  items: TransactionView[]
  /** Opaque position of the last returned row; null means the selected window is exhausted. */
  nextCursor: string | null
}

export type MemberView = {
  userId: string
  firstName: string
  username: string | null
  role: 'owner' | 'editor'
}

export type AccountInvitePreview = {
  accountId: string
  workspaceId: string
  accountName: string
  inviterName: string
  role: 'editor'
  expiresAt: string
  status: 'active' | 'accepted' | 'expired' | 'revoked'
}

export type DashboardSummary = {
  periodStart: string
  periodEnd: string
  granularity: 'day' | 'month'
  elapsedDays: number
  /** Calendar days from the first recorded operation to the period cutoff. */
  observedDayCount: number
  netKopecks: number
  incomeKopecks: number
  expenseKopecks: number
  averageExpensePerDayKopecks: number
  largestExpenseKopecks: number
  largestExpenseCategoryId: string | null
  largestIncomeKopecks: number
  largestIncomeCategoryId: string | null
  mostExpensiveDayKopecks: number
  mostExpensiveDay: string | null
  expenseFreeStreakDays: number
  weekendExpenseSharePercent: number
  operationCount: number
  mostFrequentExpenseCategoryId: string | null
  mostFrequentExpenseCategoryCount: number
  byCategory: Array<{ categoryId: string | null; name: string; color: string; icon: string | null; amountKopecks: number; type: 'income' | 'expense' }>
  trend: Array<{ date: string; incomeKopecks: number; expenseKopecks: number }>
}

export type AppSnapshot = {
  user: { id: string; firstName: string; username: string | null; timezone: string }
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string
  /** null means the aggregate "Все счета" scope inside activeWorkspaceId. */
  activeAccountId: string | null
  accounts: AccountView[]
  categories: CategoryView[]
  transactions: TransactionView[]
  /** Continue the journal through GET /transactions without growing the snapshot. */
  transactionsNextCursor: string | null
  members: MemberView[]
  summary: DashboardSummary
}

export type ApiErrorShape = {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]>; requestId: string }
}

/** One line from the iOS shortcut: an amount and a free-text description. */
export const quickEntrySchema = z.object({
  amount: z.union([z.string().min(1).max(32), z.number()]),
  text: z.string().trim().max(200).default(''),
})
export type QuickEntryInput = z.infer<typeof quickEntrySchema>
