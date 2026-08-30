import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const workspaceKind = pgEnum('workspace_kind', ['personal', 'family'])
export const memberRole = pgEnum('member_role', ['owner', 'member'])
export const accountAccessRole = pgEnum('account_access_role', ['owner', 'editor'])
export const accountKind = pgEnum('account_kind', ['cash', 'card', 'savings', 'other'])
export const transactionType = pgEnum('transaction_type', ['expense', 'income', 'transfer'])
export const transactionSource = pgEnum('transaction_source', ['manual', 'import', 'voice', 'receipt', 'shortcut'])
export const categoryType = pgEnum('category_type', ['expense', 'income'])
export const budgetKind = pgEnum('budget_kind', ['budget', 'goal'])
export const budgetPeriod = pgEnum('budget_period', ['month', 'year'])
export const draftStatus = pgEnum('draft_status', ['pending', 'confirmed', 'rejected'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).notNull(),
  username: text('username'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  timezone: text('timezone').default('Europe/Moscow').notNull(),
  currency: text('currency').default('RUB').notNull(),
  theme: text('theme').default('system').notNull(),
  interfaceLanguage: text('interface_language').default('ru').notNull(),
  voiceLanguage: text('voice_language').default('ru-RU').notNull(),
  firstDayOfWeek: integer('first_day_of_week').default(1).notNull(),
  quickActions: jsonb('quick_actions').$type<{ scan: boolean; voice: boolean; primary: 'scan' | 'voice' | 'manual' }>()
    .default({ scan: true, voice: true, primary: 'scan' }).notNull(),
  calculatorEnabled: boolean('calculator_enabled').default(true).notNull(),
  // Only the hash is kept: the key itself is shown once and then lives on the phone.
  quickKeyHash: text('quick_key_hash'),
  quickKeyIssuedAt: timestamp('quick_key_issued_at', { withTimezone: true }),
  alwaysShowIncome: boolean('always_show_income').default(true).notNull(),
  roundTotals: boolean('round_totals').default(false).notNull(),
  transferAsIncomeExpense: boolean('transfer_as_income_expense').default(false).notNull(),
  adjustmentAsIncomeExpense: boolean('adjustment_as_income_expense').default(false).notNull(),
  botWriteAccess: boolean('bot_write_access').default(false).notNull(),
  activeWorkspaceId: uuid('active_workspace_id'),
  activeAccountId: uuid('active_account_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex('users_telegram_user_id_idx').on(table.telegramUserId)])

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('sessions_token_hash_idx').on(table.tokenHash), index('sessions_user_idx').on(table.userId)])

export const workspaces = pgTable('workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  kind: workspaceKind('kind').notNull(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  ...timestamps,
}, (table) => [index('workspaces_owner_idx').on(table.ownerUserId)])

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: memberRole('role').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] }), index('workspace_members_user_idx').on(table.userId)])

export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedByUserId: uuid('used_by_user_id').references(() => users.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('workspace_invites_token_idx').on(table.tokenHash)])

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  kind: accountKind('kind').default('cash').notNull(),
  icon: text('icon').default('wallet').notNull(),
  color: text('color').default('#32D583').notNull(),
  openingBalanceKopecks: bigint('opening_balance_kopecks', { mode: 'number' }).default(0).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  ...timestamps,
}, (table) => [index('accounts_workspace_idx').on(table.workspaceId)])

export const accountMembers = pgTable('account_members', {
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: accountAccessRole('role').notNull(),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.userId] }),
  index('account_members_user_idx').on(table.userId),
])

export const accountInvites = pgTable('account_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id).notNull(),
  role: accountAccessRole('role').default('editor').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedByUserId: uuid('used_by_user_id').references(() => users.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('account_invites_token_idx').on(table.tokenHash),
  index('account_invites_account_idx').on(table.accountId),
])

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  type: categoryType('type').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
  order: integer('sort_order').default(0).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  ...timestamps,
}, (table) => [
  index('categories_workspace_idx').on(table.workspaceId),
  index('categories_workspace_type_order_idx').on(table.workspaceId, table.type, table.order),
])

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  type: transactionType('type').notNull(),
  amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  targetAccountId: uuid('target_account_id').references(() => accounts.id),
  categoryId: uuid('category_id').references(() => categories.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  note: text('note').default('').notNull(),
  source: transactionSource('source').default('manual').notNull(),
  // The category was matched from text rather than chosen, so the app can ask.
  categoryGuessed: boolean('category_guessed').default(false).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  ...timestamps,
}, (table) => [
  index('transactions_workspace_date_idx').on(table.workspaceId, table.occurredAt),
  index('transactions_account_idx').on(table.accountId),
])

export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  kind: budgetKind('kind').default('budget').notNull(),
  name: text('name').notNull(),
  amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
  period: budgetPeriod('period').notNull(),
  startDay: integer('start_day').default(1).notNull(),
  color: text('color').default('#050505').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [index('budgets_workspace_idx').on(table.workspaceId)])

export const budgetAccounts = pgTable('budget_accounts', {
  budgetId: uuid('budget_id').references(() => budgets.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }).notNull(),
}, (table) => [primaryKey({ columns: [table.budgetId, table.accountId] })])

export const budgetCategories = pgTable('budget_categories', {
  budgetId: uuid('budget_id').references(() => budgets.id, { onDelete: 'cascade' }).notNull(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }).notNull(),
}, (table) => [primaryKey({ columns: [table.budgetId, table.categoryId] })])

export const reminders = pgTable('reminders', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  timezone: text('timezone').default('Europe/Moscow').notNull(),
  localTime: text('local_time').default('20:00').notNull(),
  daysOfWeek: integer('days_of_week').array().default([1, 2, 3, 4, 5, 6, 7]).notNull(),
  text: text('text').default('Пора внести расходы и доходы.').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const reminderDeliveries = pgTable('reminder_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  error: text('error'),
}, (table) => [uniqueIndex('reminder_deliveries_once_idx').on(table.userId, table.scheduledFor)])

export const aiDrafts = pgTable('ai_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  inputType: text('input_type').notNull(),
  status: draftStatus('status').default('pending').notNull(),
  parsedData: jsonb('parsed_data').notNull(),
  confidence: integer('confidence').default(0).notNull(),
  warnings: jsonb('warnings').default([]).notNull(),
  provider: text('provider').default('stub').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [index('ai_drafts_user_status_idx').on(table.createdByUserId, table.status)])

export const mediaObjects = pgTable('media_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  draftId: uuid('draft_id').references(() => aiDrafts.id, { onDelete: 'cascade' }).notNull(),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('media_objects_key_idx').on(table.objectKey)])

export const shortcutTokens = pgTable('shortcut_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('shortcut_tokens_hash_idx').on(table.tokenHash), index('shortcut_tokens_user_idx').on(table.userId)])

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  operation: text('operation').notNull(),
  response: jsonb('response').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  data: jsonb('data').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index('audit_log_workspace_idx').on(table.workspaceId, table.createdAt)])

export const processedTelegramUpdates = pgTable('processed_telegram_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
})
