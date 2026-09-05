import { randomUUID } from 'node:crypto'
import { addDays } from 'date-fns'
import pg, { type PoolClient } from 'pg'
import {
  type AccountView,
  type AccountInvitePreview,
  type AppSnapshot,
  type CategoryView,
  type DashboardSummary,
  type MemberView,
  type TransactionPage,
  type TransactionView,
  type WorkspaceSummary,
} from '../../src/shared/contracts.js'
import type { TelegramIdentity } from '../auth/telegram.js'
import { hashQuickKey, issueQuickKey } from '../lib/quick-key.js'
import { parseQuickAmount, resolveQuickEntry } from '../../src/shared/quick-entry.js'
import { zonedDayNumber } from '../../src/shared/timezone.js'
import { DATA_COLORS } from '../../src/shared/design-tokens.js'
import { resolveRange, type SnapshotRange } from '../lib/range.js'
import { decodeTransactionCursor, encodeTransactionCursor } from '../lib/transaction-cursor.js'
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js'
import type { DeliveryKind, ReminderCandidate } from '../telegram/reminders.js'
import { hashToken, randomToken } from '../lib/security.js'
import type {
  AccountInput,
  ReminderSettingsInput,
  SharedActivity,
  AccountUpdate,
  ActiveAccountInput,
  CategoryInput,
  CategoryReorder,
  CategoryUpdate,
  FinanceStore,
  QuickEntryInput,
  SessionUser,
  TransactionInput,
  TransactionUpdate,
  WorkspaceInput,
} from './types.js'
import { expenseCategories, incomeCategories } from './default-categories.js'

const { Pool } = pg
type Queryable = Pick<PoolClient, 'query'>


export class PostgresFinanceStore implements FinanceStore {
  private pool: InstanceType<typeof Pool>
  constructor(databaseUrl: string) { this.pool = new Pool({ connectionString: databaseUrl, max: 10 }) }

  async createSession(identity: TelegramIdentity, timezone: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      let userResult = await client.query(`SELECT id, first_name, username, timezone FROM users WHERE telegram_user_id = $1 AND deleted_at IS NULL FOR UPDATE`, [identity.id])
      let userId: string
      if (!userResult.rowCount) {
        userId = randomUUID()
        await client.query(`INSERT INTO users (id, telegram_user_id, first_name, last_name, username, timezone, bot_write_access) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [userId, identity.id, identity.firstName, identity.lastName, identity.username, timezone, identity.allowsWriteToPm === true])
        const workspaceId = randomUUID()
        await client.query(`INSERT INTO workspaces (id, kind, name, owner_user_id) VALUES ($1,'personal','Личные финансы',$2)`, [workspaceId, userId])
        await client.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [workspaceId, userId])
        const accountId = await this.seedWorkspace(client, workspaceId, userId)
        await client.query(`UPDATE users SET active_workspace_id=$2,active_account_id=$3 WHERE id=$1`, [userId, workspaceId, accountId])
      } else {
        userId = userResult.rows[0].id as string
        await client.query(`UPDATE users SET first_name=$2,last_name=$3,username=$4,timezone=$5,bot_write_access=bot_write_access OR $6,updated_at=now() WHERE id=$1`, [userId, identity.firstName, identity.lastName, identity.username, timezone, identity.allowsWriteToPm === true])
      }
      const token = randomToken()
      await client.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '30 days')`, [userId, hashToken(token)])
      await client.query('COMMIT')
      return { token, user: { id: userId, firstName: identity.firstName, username: identity.username, timezone } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async noteBotContact(telegramUserId: number) {
    const result = await this.pool.query(
      `UPDATE users SET bot_write_access=true,updated_at=now() WHERE telegram_user_id=$1 AND deleted_at IS NULL`,
      [telegramUserId],
    )
    return { known: Boolean(result.rowCount) }
  }

  async claimTelegramUpdate(updateId: number) {
    const result = await this.pool.query(
      `INSERT INTO processed_telegram_updates (update_id) VALUES ($1) ON CONFLICT (update_id) DO NOTHING`,
      [updateId],
    )
    return result.rowCount === 1
  }

  async releaseTelegramUpdate(updateId: number) {
    await this.pool.query(`DELETE FROM processed_telegram_updates WHERE update_id=$1`, [updateId])
  }

  async userForSession(token: string) {
    const result = await this.pool.query(`SELECT u.id,u.first_name,u.username,u.timezone FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.deleted_at IS NULL`, [hashToken(token)])
    if (!result.rowCount) return null
    await this.pool.query(`UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1`, [hashToken(token)])
    return userRow(result.rows[0])
  }

  async telegramUserIdFor(userId: string) {
    const result = await this.pool.query(`SELECT telegram_user_id FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId])
    return result.rowCount ? Number(result.rows[0].telegram_user_id) : null
  }

  async revokeSession(token: string) { await this.pool.query(`DELETE FROM sessions WHERE token_hash=$1`, [hashToken(token)]) }

  async snapshot(userId: string, workspaceId?: string, range?: SnapshotRange, requestedAccountId?: string | null): Promise<AppSnapshot> {
    const userResult = await this.pool.query(`SELECT id,first_name,username,timezone,active_workspace_id,active_account_id FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId])
    if (!userResult.rowCount) throw forbidden()
    const accessibleResult = await this.pool.query(`WITH deltas AS (
      SELECT account_id,SUM(CASE WHEN type='income' THEN amount_kopecks ELSE -amount_kopecks END) AS amount
      FROM transactions WHERE deleted_at IS NULL GROUP BY account_id
      UNION ALL
      SELECT target_account_id AS account_id,SUM(amount_kopecks) AS amount
      FROM transactions WHERE deleted_at IS NULL AND type='transfer' AND target_account_id IS NOT NULL GROUP BY target_account_id
    ), totals AS (SELECT account_id,SUM(amount) AS amount FROM deltas GROUP BY account_id), member_counts AS (
      SELECT account_id,COUNT(*)::int AS member_count FROM account_members GROUP BY account_id
    )
    SELECT a.*,am.role AS access_role,COALESCE(mc.member_count,1) AS member_count,
      a.opening_balance_kopecks+COALESCE(totals.amount,0) AS balance_kopecks
    FROM account_members am JOIN accounts a ON a.id=am.account_id
    LEFT JOIN totals ON totals.account_id=a.id LEFT JOIN member_counts mc ON mc.account_id=a.id
    JOIN workspaces w ON w.id=a.workspace_id
    WHERE am.user_id=$1 AND a.archived_at IS NULL AND w.deleted_at IS NULL
    ORDER BY CASE am.role WHEN 'owner' THEN 0 ELSE 1 END,a.created_at`, [userId])
    const accounts: AccountView[] = accessibleResult.rows.map((row) => ({ ...accountRow(row), balanceKopecks: Number(row.balance_kopecks) }))
    const workspaceResult = await this.pool.query(`SELECT w.id,w.name,w.kind,
      CASE WHEN bool_or(am.role='owner') THEN 'owner' ELSE 'member' END AS role
      FROM workspaces w JOIN accounts a ON a.workspace_id=w.id JOIN account_members am ON am.account_id=a.id
      WHERE am.user_id=$1 AND a.archived_at IS NULL AND w.deleted_at IS NULL GROUP BY w.id ORDER BY w.kind DESC,w.created_at`, [userId])
    const workspaces: WorkspaceSummary[] = workspaceResult.rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, role: row.role }))
    const currentUser = userResult.rows[0]
    const persisted = currentUser.active_account_id && accounts.find((item) => item.id === currentUser.active_account_id && !item.archivedAt)
    const selectedAccount = requestedAccountId === undefined
      ? persisted || null
      : requestedAccountId === null
        ? null
        : accounts.find((item) => item.id === requestedAccountId && !item.archivedAt) || null
    if (requestedAccountId && !selectedAccount) throw forbidden('Нет доступа к этому кошельку')
    const activeWorkspaceId = selectedAccount?.workspaceId
      || (workspaceId && workspaces.some((item) => item.id === workspaceId) ? workspaceId : null)
      || (currentUser.active_workspace_id && workspaces.some((item) => item.id === currentUser.active_workspace_id) ? currentUser.active_workspace_id : null)
      || workspaces[0]?.id
    if (!activeWorkspaceId) throw notFound('Пространство не найдено')
    const scopedAccountIds = selectedAccount
      ? [selectedAccount.id]
      : accounts.filter((item) => item.workspaceId === activeWorkspaceId && !item.archivedAt).map((item) => item.id)
    if (!scopedAccountIds.length) throw notFound('Кошелёк не найден')
    const window = resolveRange(range)
    const byMonth = zonedDayNumber(window.end, currentUser.timezone) - zonedDayNumber(window.start, currentUser.timezone) > 62
    const [categoryResult, journalPage, memberResult, summaryResult, categorySummaryResult, trendResult] = await Promise.all([
      this.pool.query(`SELECT c.*,COUNT(t.id) AS usage_count FROM categories c
        LEFT JOIN transactions t ON t.category_id=c.id AND t.workspace_id=c.workspace_id AND t.deleted_at IS NULL AND (t.account_id=ANY($2::uuid[]) OR t.target_account_id=ANY($2::uuid[]))
        WHERE c.workspace_id=$1 GROUP BY c.id ORDER BY c.archived_at NULLS FIRST,c.type,c.sort_order,c.name`, [activeWorkspaceId, scopedAccountIds]),
      this.transactionPageRows(activeWorkspaceId, window, undefined, 20, scopedAccountIds),
      selectedAccount ? this.pool.query(`SELECT u.id AS user_id,u.first_name,u.username,am.role FROM account_members am JOIN users u ON u.id=am.user_id WHERE am.account_id=$1 ORDER BY am.role,am.joined_at`, [selectedAccount.id]) : Promise.resolve({ rows: [] }),
      this.pool.query(`WITH period AS (
        SELECT id,type,amount_kopecks,category_id,occurred_at FROM transactions
        WHERE workspace_id=$1 AND deleted_at IS NULL AND occurred_at BETWEEN $2 AND $3 AND account_id=ANY($5::uuid[])
      ), days AS (
        SELECT to_char(occurred_at AT TIME ZONE $4,'YYYY-MM-DD') AS day,SUM(amount_kopecks) AS amount
        FROM period WHERE type='expense' GROUP BY day ORDER BY amount DESC,day LIMIT 1
      )
      SELECT COALESCE(SUM(amount_kopecks) FILTER (WHERE type='income'),0) AS income,
        COALESCE(SUM(amount_kopecks) FILTER (WHERE type='expense'),0) AS expense,
        COALESCE(MAX(amount_kopecks) FILTER (WHERE type='income'),0) AS largest_income,
        (SELECT category_id FROM period WHERE type='income' ORDER BY amount_kopecks DESC,occurred_at DESC,id DESC LIMIT 1) AS largest_income_category_id,
        COALESCE(MAX(amount_kopecks) FILTER (WHERE type='expense'),0) AS largest_expense,
        (SELECT category_id FROM period WHERE type='expense' ORDER BY amount_kopecks DESC,occurred_at DESC,id DESC LIMIT 1) AS largest_expense_category_id,
        COALESCE((SELECT amount FROM days),0) AS most_expensive_day_amount,
        (SELECT day FROM days) AS most_expensive_day,
        COALESCE(SUM(amount_kopecks) FILTER (
          WHERE type='expense' AND EXTRACT(ISODOW FROM occurred_at AT TIME ZONE $4) IN (6,7)
        ),0) AS weekend_expense,
        COUNT(*) AS operation_count,
        MIN(to_char(occurred_at AT TIME ZONE $4,'YYYY-MM-DD')) AS first_observed_day,
        ARRAY(SELECT DISTINCT to_char(item.occurred_at AT TIME ZONE $4,'YYYY-MM-DD') FROM period item WHERE item.type='expense') AS expense_days
      FROM period`, [activeWorkspaceId, window.start, window.end, currentUser.timezone, scopedAccountIds]),
      this.pool.query(`SELECT t.type,t.category_id,COALESCE(c.name,'Без категории') AS name,
        COALESCE(c.color,$4) AS color,c.icon,SUM(t.amount_kopecks) AS amount,COUNT(*) AS count
      FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
      WHERE t.workspace_id=$1 AND t.deleted_at IS NULL AND t.occurred_at BETWEEN $2 AND $3 AND t.type IN ('income','expense') AND t.account_id=ANY($5::uuid[])
      GROUP BY t.type,t.category_id,c.name,c.color,c.icon ORDER BY amount DESC`, [activeWorkspaceId, window.start, window.end, DATA_COLORS.categoryFallback, scopedAccountIds]),
      this.pool.query(`SELECT to_char(occurred_at AT TIME ZONE $4,$5) AS bucket,
        COALESCE(SUM(amount_kopecks) FILTER (WHERE type='income'),0) AS income,
        COALESCE(SUM(amount_kopecks) FILTER (WHERE type='expense'),0) AS expense
      FROM transactions
      WHERE workspace_id=$1 AND deleted_at IS NULL AND occurred_at BETWEEN $2 AND $3 AND type IN ('income','expense') AND account_id=ANY($6::uuid[])
      GROUP BY bucket ORDER BY bucket`, [activeWorkspaceId, window.start, window.end, currentUser.timezone, byMonth ? 'YYYY-MM' : 'YYYY-MM-DD', scopedAccountIds]),
    ])
    const categories: CategoryView[] = categoryResult.rows.map(categoryRow)
    const summary = summaryFromSql(summaryResult.rows[0], categorySummaryResult.rows, trendResult.rows, window, byMonth, currentUser.timezone)
    return {
      user: { id: currentUser.id, firstName: currentUser.first_name, username: currentUser.username, timezone: currentUser.timezone },
      workspaces, activeWorkspaceId, activeAccountId: selectedAccount?.id || null, accounts, categories,
      transactions: journalPage.items,
      transactionsNextCursor: journalPage.nextCursor,
      members: memberResult.rows.map((row): MemberView => ({ userId: row.user_id, firstName: row.first_name, username: row.username, role: row.role })),
      summary,
    }
  }

  async transactionsPage(userId: string, workspaceId: string, range: SnapshotRange, cursor?: string, limit = 20, accountId?: string | null): Promise<TransactionPage> {
    const result = await this.pool.query(`SELECT a.id FROM account_members am JOIN accounts a ON a.id=am.account_id WHERE am.user_id=$1 AND a.workspace_id=$2 AND a.archived_at IS NULL`, [userId, workspaceId])
    const allowed = result.rows.map((row) => row.id as string)
    if (accountId && !allowed.includes(accountId)) throw forbidden('Нет доступа к этому кошельку')
    const scope = accountId ? [accountId] : allowed
    if (!scope.length) throw forbidden('Нет доступа к этому пространству')
    return this.transactionPageRows(workspaceId, resolveRange(range), cursor, limit, scope)
  }

  async issueQuickKey(userId: string) {
    const { key, hash } = issueQuickKey()
    await this.pool.query('UPDATE users SET quick_key_hash=$1, quick_key_issued_at=now() WHERE id=$2', [hash, userId])
    return { key }
  }

  async hasQuickKey(userId: string) {
    const result = await this.pool.query('SELECT quick_key_hash FROM users WHERE id=$1', [userId])
    return Boolean(result.rows[0]?.quick_key_hash)
  }

  async createQuickEntry(key: string, input: QuickEntryInput) {
    // Looked up by hash, so the key itself never has to be compared in SQL.
    const owner = await this.pool.query('SELECT id, active_account_id FROM users WHERE quick_key_hash=$1 AND deleted_at IS NULL', [hashQuickKey(key)])
    const user = owner.rows[0]
    if (!user) throw new AppError(401, 'QUICK_KEY_INVALID', 'Ключ не подходит')
    return this.recordQuickEntry(user.id as string, user.active_account_id as string | null, input, 'shortcut')
  }

  async createBotEntry(telegramUserId: number, input: QuickEntryInput) {
    const owner = await this.pool.query('SELECT id, active_account_id FROM users WHERE telegram_user_id=$1 AND deleted_at IS NULL', [telegramUserId])
    const user = owner.rows[0]
    if (!user) throw new AppError(404, 'BOT_USER_UNKNOWN', 'Сначала откройте приложение')
    return this.recordQuickEntry(user.id as string, user.active_account_id as string | null, input, 'bot')
  }

  /**
   * The single path every free-text entry takes, whichever door it came in by.
   * Only the source column differs, so an improvement to category matching
   * reaches the shortcut and the bot at the same moment.
   */
  private async recordQuickEntry(userId: string, activeAccountId: string | null, input: QuickEntryInput, source: 'shortcut' | 'bot') {
    const user = { id: userId, active_account_id: activeAccountId }
    const amountKopecks = parseQuickAmount(input.amount)
    if (!amountKopecks) throw new AppError(400, 'QUICK_AMOUNT_INVALID', 'Не разобрали сумму')

    const accountResult = await this.pool.query(
      `SELECT a.id,a.workspace_id FROM account_members am JOIN accounts a ON a.id=am.account_id
       WHERE am.user_id=$1 AND a.archived_at IS NULL
       ORDER BY CASE WHEN a.id=$2 THEN 0 ELSE 1 END,CASE am.role WHEN 'owner' THEN 0 ELSE 1 END,a.created_at LIMIT 1`, [user.id, user.active_account_id])
    const accountId = accountResult.rows[0]?.id
    if (!accountId) throw notFound('Счёт не найден')
    const workspaceId = accountResult.rows[0].workspace_id as string

    const [categoryResult, historyResult] = await Promise.all([
      this.pool.query('SELECT * FROM categories WHERE workspace_id=$1', [workspaceId]),
      this.pool.query(
        `SELECT note, category_id, type FROM transactions WHERE workspace_id=$1 AND deleted_at IS NULL
         ORDER BY occurred_at DESC LIMIT 300`, [workspaceId]),
    ])
    const categories = categoryResult.rows.map(categoryRow)
    const history = historyResult.rows.map((row) => ({
      note: row.note as string,
      categoryId: row.category_id as string | null,
      type: row.type as TransactionView['type'],
    }))
    const entry = resolveQuickEntry(input.text, amountKopecks, categories, history)

    const inserted = await this.pool.query(
      `INSERT INTO transactions (workspace_id,type,amount_kopecks,account_id,category_id,occurred_at,note,source,category_guessed,created_by_user_id)
       VALUES ($1,'expense',$2,$3,$4,now(),$5,$8,$6,$7) RETURNING id`,
      [workspaceId, entry.amountKopecks, accountId, entry.categoryId, entry.note, entry.categoryGuessed, user.id, source])
    return {
      id: inserted.rows[0].id as string,
      categoryName: categories.find((item) => item.id === entry.categoryId)?.name ?? null,
      categoryGuessed: entry.categoryGuessed,
      amountKopecks: entry.amountKopecks,
    }
  }

  async createTransaction(userId: string, input: TransactionInput, idempotencyKey: string) {
    const client = await this.pool.connect(); const key = `${userId}:transaction:${idempotencyKey}`
    try {
      await client.query('BEGIN')
      const sourceAccess = await this.assertAccountAccess(client, userId, input.accountId)
      if (sourceAccess.workspaceId !== input.workspaceId) throw forbidden('Кошелёк принадлежит другому пространству')
      if (input.targetAccountId) {
        const targetAccess = await this.assertAccountAccess(client, userId, input.targetAccountId)
        if (targetAccess.workspaceId !== input.workspaceId) throw forbidden('Счёт назначения принадлежит другому пространству')
      }
      await this.validateRelations(client, input.workspaceId, input)
      const seen = await client.query(`SELECT response FROM idempotency_keys WHERE key=$1 AND user_id=$2`, [key, userId])
      if (seen.rowCount) { await client.query('COMMIT'); return seen.rows[0].response as { id: string } }
      const id = randomUUID()
      await client.query(`INSERT INTO transactions (id,workspace_id,type,amount_kopecks,account_id,target_account_id,category_id,occurred_at,note,source,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, [id, input.workspaceId, input.type, input.amountKopecks, input.accountId, input.targetAccountId || null, input.categoryId || null, input.occurredAt, input.note, input.source, userId])
      await client.query(`INSERT INTO idempotency_keys (key,user_id,operation,response) VALUES ($1,$2,'create_transaction',$3)`, [key, userId, JSON.stringify({ id })])
      await this.audit(client, input.workspaceId, userId, 'transaction', id, 'create', { type: input.type, amountKopecks: input.amountKopecks })
      await client.query('COMMIT'); return { id }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async updateTransaction(userId: string, transactionId: string, input: TransactionUpdate) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query(`SELECT workspace_id,version,account_id,target_account_id FROM transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [transactionId])
      if (!found.rowCount) throw notFound('Операция не найдена')
      const workspaceId = found.rows[0].workspace_id as string
      await this.assertAccountAccess(client, userId, found.rows[0].account_id)
      if (found.rows[0].target_account_id) await this.assertAccountAccess(client, userId, found.rows[0].target_account_id)
      if (found.rows[0].version !== input.version) throw conflict()
      await this.assertAccountAccess(client, userId, input.accountId)
      if (input.targetAccountId) await this.assertAccountAccess(client, userId, input.targetAccountId)
      await this.validateRelations(client, workspaceId, input)
      await client.query(`UPDATE transactions SET type=$2,amount_kopecks=$3,account_id=$4,target_account_id=$5,category_id=$6,occurred_at=$7,note=$8,updated_by_user_id=$9,updated_at=now(),version=version+1 WHERE id=$1`, [transactionId, input.type, input.amountKopecks, input.accountId, input.targetAccountId || null, input.categoryId || null, input.occurredAt, input.note, userId])
      await this.audit(client, workspaceId, userId, 'transaction', transactionId, 'update', { version: input.version + 1 }); await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async deleteTransaction(userId: string, transactionId: string, version: number) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN'); const found = await client.query(`SELECT workspace_id,version,account_id,target_account_id FROM transactions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [transactionId])
      if (!found.rowCount) throw notFound('Операция не найдена')
      await this.assertAccountAccess(client, userId, found.rows[0].account_id)
      if (found.rows[0].target_account_id) await this.assertAccountAccess(client, userId, found.rows[0].target_account_id)
      if (found.rows[0].version !== version) throw conflict()
      await client.query(`UPDATE transactions SET deleted_at=now(),updated_by_user_id=$2,updated_at=now(),version=version+1 WHERE id=$1`, [transactionId, userId])
      await this.audit(client, found.rows[0].workspace_id, userId, 'transaction', transactionId, 'delete', { version: version + 1 }); await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async createAccount(userId: string, input: AccountInput) {
    const client = await this.pool.connect(); const id = randomUUID()
    try {
      await client.query('BEGIN')
      await this.assertWorkspaceOwner(client, userId, input.workspaceId)
      await client.query(`INSERT INTO accounts (id,workspace_id,name,kind,icon,color,opening_balance_kopecks) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, input.workspaceId, input.name, input.kind, input.icon, input.color, input.openingBalanceKopecks])
      await client.query(`INSERT INTO account_members (account_id,user_id,role) VALUES ($1,$2,'owner')`, [id, userId])
      await client.query(`UPDATE users SET active_workspace_id=$2,active_account_id=$3,updated_at=now() WHERE id=$1`, [userId, input.workspaceId, id])
      await this.audit(client, input.workspaceId, userId, 'account', id, 'create', { name: input.name })
      await client.query('COMMIT'); return { id }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async updateAccount(userId: string, accountId: string, input: AccountUpdate) {
    const result = await this.pool.query(`UPDATE accounts account SET name=$3,updated_at=now(),version=version+1
      FROM account_members access WHERE account.id=$1 AND account.version=$2 AND account.archived_at IS NULL
      AND access.account_id=account.id AND access.user_id=$4 AND access.role='owner' RETURNING account.workspace_id`, [accountId, input.version, input.name, userId])
    if (!result.rowCount) {
      const access = await this.pool.query(`SELECT a.version,am.role FROM accounts a LEFT JOIN account_members am ON am.account_id=a.id AND am.user_id=$2 WHERE a.id=$1 AND a.archived_at IS NULL`, [accountId, userId])
      if (!access.rowCount) throw notFound('Кошелёк не найден')
      if (access.rows[0].role !== 'owner') throw forbidden('Только владелец переименовывает кошелёк')
      throw conflict('Кошелёк уже изменён — обновите экран')
    }
  }
  async archiveAccount(userId: string, accountId: string, version: number) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const access = await this.assertAccountAccess(client, userId, accountId)
      if (access.role !== 'owner') throw forbidden('Только владелец удаляет кошелёк')
      if (access.version !== version) throw conflict('Кошелёк уже изменён — обновите экран')
      const remaining = await client.query(`SELECT COUNT(*)::int AS count FROM account_members am JOIN accounts a ON a.id=am.account_id WHERE am.user_id=$1 AND am.role='owner' AND a.archived_at IS NULL AND a.id<>$2`, [userId, accountId])
      if (!Number(remaining.rows[0].count)) throw conflict('Нельзя удалить последний личный кошелёк')
      await client.query(`UPDATE accounts SET archived_at=now(),updated_at=now(),version=version+1 WHERE id=$1`, [accountId])
      await client.query(`UPDATE account_invites SET revoked_at=now() WHERE account_id=$1 AND used_at IS NULL AND revoked_at IS NULL`, [accountId])
      await client.query(`UPDATE users SET active_account_id=NULL WHERE active_account_id=$1`, [accountId])
      await this.audit(client, access.workspaceId, userId, 'account', accountId, 'archive', { version: version + 1 })
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async setActiveAccount(userId: string, input: ActiveAccountInput) {
    if (input.accountId) {
      const access = await this.assertAccountAccess(this.pool, userId, input.accountId)
      if (access.workspaceId !== input.workspaceId) throw forbidden('Кошелёк принадлежит другому пространству')
    } else {
      const accessible = await this.pool.query(`SELECT 1 FROM account_members am JOIN accounts a ON a.id=am.account_id WHERE am.user_id=$1 AND a.workspace_id=$2 AND a.archived_at IS NULL LIMIT 1`, [userId, input.workspaceId])
      if (!accessible.rowCount) throw forbidden('Нет доступных кошельков в этом пространстве')
    }
    await this.pool.query(`UPDATE users SET active_workspace_id=$2,active_account_id=$3,updated_at=now() WHERE id=$1`, [userId, input.workspaceId, input.accountId])
  }

  async createAccountInvite(userId: string, accountId: string) {
    const access = await this.assertAccountAccess(this.pool, userId, accountId)
    if (access.role !== 'owner') throw forbidden('Только владелец создаёт приглашения')
    const id = randomUUID(); const token = randomToken(24); const expiresAt = addDays(new Date(), 1)
    await this.pool.query(`INSERT INTO account_invites (id,account_id,created_by_user_id,role,token_hash,expires_at) VALUES ($1,$2,$3,'editor',$4,$5)`, [id, accountId, userId, hashToken(token), expiresAt])
    return { id, token, expiresAt: expiresAt.toISOString() }
  }

  async previewAccountInvite(_userId: string, token: string): Promise<AccountInvitePreview> {
    const result = await this.pool.query(`SELECT invite.account_id,account.workspace_id,account.name AS account_name,user_row.first_name AS inviter_name,invite.role,invite.expires_at,invite.used_at,invite.revoked_at
      FROM account_invites invite JOIN accounts account ON account.id=invite.account_id JOIN users user_row ON user_row.id=invite.created_by_user_id WHERE invite.token_hash=$1`, [hashToken(token)])
    if (!result.rowCount) throw notFound('Приглашение не найдено')
    const row = result.rows[0]
    const status = row.revoked_at ? 'revoked' : row.used_at ? 'accepted' : new Date(row.expires_at) < new Date() ? 'expired' : 'active'
    return { accountId: row.account_id, workspaceId: row.workspace_id, accountName: row.account_name, inviterName: row.inviter_name, role: 'editor', expiresAt: new Date(row.expires_at).toISOString(), status }
  }

  async acceptAccountInvite(userId: string, token: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(`SELECT invite.*,account.workspace_id,account.archived_at FROM account_invites invite JOIN accounts account ON account.id=invite.account_id WHERE invite.token_hash=$1 FOR UPDATE`, [hashToken(token)])
      const invite = result.rows[0]
      if (!invite || invite.revoked_at || invite.archived_at || new Date(invite.expires_at) < new Date()) throw conflict('Приглашение недействительно или истекло')
      if (invite.created_by_user_id === userId) throw conflict('Нельзя принять собственное приглашение')
      if (invite.used_at) {
        if (invite.used_by_user_id !== userId) throw conflict('Приглашение уже использовано')
        await client.query('COMMIT'); return { workspaceId: invite.workspace_id as string, accountId: invite.account_id as string }
      }
      await client.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [invite.workspace_id, userId])
      await client.query(`INSERT INTO account_members (account_id,user_id,role,invited_by_user_id) VALUES ($1,$2,'editor',$3) ON CONFLICT (account_id,user_id) DO UPDATE SET role='editor',invited_by_user_id=$3`, [invite.account_id, userId, invite.created_by_user_id])
      await client.query(`UPDATE account_invites SET used_at=now(),used_by_user_id=$2 WHERE id=$1`, [invite.id, userId])
      await client.query(`UPDATE users SET active_workspace_id=$2,active_account_id=$3,updated_at=now() WHERE id=$1`, [userId, invite.workspace_id, invite.account_id])
      await this.audit(client, invite.workspace_id, userId, 'account_invite', invite.id, 'accept', { accountId: invite.account_id })
      // Read inside the transaction so the notification cannot describe a state
      // the commit then rolls back.
      const joined = await client.query(
        `SELECT inviter.telegram_user_id, inviter.bot_write_access, account.name AS account_name, member.first_name AS member_name
           FROM accounts account
           JOIN users inviter ON inviter.id=$2
           JOIN users member ON member.id=$3
          WHERE account.id=$1`, [invite.account_id, invite.created_by_user_id, userId])
      const row = joined.rows[0]
      await client.query('COMMIT')
      return {
        workspaceId: invite.workspace_id as string,
        accountId: invite.account_id as string,
        joined: row ? {
          inviterTelegramUserId: row.bot_write_access ? Number(row.telegram_user_id) : null,
          accountName: row.account_name as string,
          memberName: row.member_name as string,
        } : undefined,
      }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async revokeAccountInvite(userId: string, accountId: string, inviteId: string) {
    const access = await this.assertAccountAccess(this.pool, userId, accountId)
    if (access.role !== 'owner') throw forbidden('Только владелец отзывает приглашения')
    const result = await this.pool.query(`UPDATE account_invites SET revoked_at=now() WHERE id=$1 AND account_id=$2 AND used_at IS NULL AND revoked_at IS NULL`, [inviteId, accountId])
    if (!result.rowCount) throw notFound('Активное приглашение не найдено')
  }

  async removeAccountMember(userId: string, accountId: string, memberUserId: string) {
    const access = await this.assertAccountAccess(this.pool, userId, accountId)
    if (access.role !== 'owner') throw forbidden('Только владелец управляет участниками')
    if (userId === memberUserId) throw forbidden('Владелец не может удалить себя')
    const result = await this.pool.query(`DELETE FROM account_members WHERE account_id=$1 AND user_id=$2 AND role='editor'`, [accountId, memberUserId])
    if (!result.rowCount) throw notFound('Участник не найден')
    await this.repairActiveAccount(memberUserId, accountId)
  }

  async leaveAccount(userId: string, accountId: string) {
    const access = await this.assertAccountAccess(this.pool, userId, accountId)
    if (access.role === 'owner') throw forbidden('Владелец не может покинуть свой кошелёк')
    await this.pool.query(`DELETE FROM account_members WHERE account_id=$1 AND user_id=$2`, [accountId, userId])
    await this.repairActiveAccount(userId, accountId)
  }
  async createCategory(userId: string, input: CategoryInput) {
    const client = await this.pool.connect(); const id = randomUUID()
    try {
      await client.query('BEGIN')
      await this.assertWorkspaceOwner(client, userId, input.workspaceId)
      await this.assertCategoryParent(client, input.workspaceId, input.type, input.parentId || null)
      const order = input.order ?? Number((await client.query(`SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM categories WHERE workspace_id=$1 AND type=$2 AND archived_at IS NULL`, [input.workspaceId, input.type])).rows[0].next_order)
      await client.query(`INSERT INTO categories (id,workspace_id,type,name,icon,color,parent_id,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, input.workspaceId, input.type, input.name, input.icon, input.color, input.parentId || null, order])
      await client.query('COMMIT'); return { id }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async updateCategory(userId: string, categoryId: string, input: CategoryUpdate) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query(`SELECT workspace_id,type,version,sort_order FROM categories WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [categoryId])
      if (!found.rowCount) throw notFound('Категория не найдена')
      const category = found.rows[0]
      await this.assertWorkspaceOwner(client, userId, category.workspace_id)
      if (category.version !== input.version) throw conflict()
      await this.assertCategoryParent(client, category.workspace_id, input.type, input.parentId || null, categoryId)
      const order = category.type === input.type ? category.sort_order : Number((await client.query(`SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM categories WHERE workspace_id=$1 AND type=$2 AND archived_at IS NULL AND id<>$3`, [category.workspace_id, input.type, categoryId])).rows[0].next_order)
      await client.query(`UPDATE categories SET type=$2,name=$3,icon=$4,color=$5,parent_id=$6,sort_order=$7,updated_at=now(),version=version+1 WHERE id=$1`, [categoryId, input.type, input.name, input.icon, input.color, input.parentId || null, order])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async reorderCategories(userId: string, input: CategoryReorder) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.assertWorkspaceOwner(client, userId, input.workspaceId)
      const active = await client.query(`SELECT id FROM categories WHERE workspace_id=$1 AND type=$2 AND archived_at IS NULL FOR UPDATE`, [input.workspaceId, input.type])
      const activeIds = new Set(active.rows.map((row) => row.id as string))
      if (activeIds.size !== input.categoryIds.length || input.categoryIds.some((id) => !activeIds.has(id))) throw conflict('Список категорий изменился — обновите экран')
      for (const [order, id] of input.categoryIds.entries()) await client.query(`UPDATE categories SET sort_order=$2,updated_at=now(),version=version+1 WHERE id=$1`, [id, order])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async archiveCategory(userId: string, categoryId: string, version: number) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query(`SELECT workspace_id,version FROM categories WHERE id=$1 AND archived_at IS NULL FOR UPDATE`, [categoryId])
      if (!found.rowCount) throw notFound('Категория не найдена')
      await this.assertWorkspaceOwner(client, userId, found.rows[0].workspace_id)
      if (found.rows[0].version !== version) throw conflict()
      await client.query(`UPDATE categories SET archived_at=now(),updated_at=now(),version=version+1 WHERE id=$1`, [categoryId])
      await client.query(`UPDATE categories SET parent_id=NULL,updated_at=now(),version=version+1 WHERE parent_id=$1 AND archived_at IS NULL`, [categoryId])
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async createWorkspace(userId: string, input: WorkspaceInput) {
    const client = await this.pool.connect(); const id = randomUUID()
    try { await client.query('BEGIN'); const user = await client.query(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [userId]); if (!user.rowCount) throw forbidden(); await client.query(`INSERT INTO workspaces (id,kind,name,owner_user_id) VALUES ($1,'family',$2,$3)`, [id, input.name, userId]); await client.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'owner')`, [id, userId]); await this.seedWorkspace(client, id, userId); await client.query('COMMIT'); return { id } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async createInvite(userId: string, workspaceId: string) {
    const member = await this.assertMember(this.pool, userId, workspaceId); if (member.role !== 'owner' || member.kind !== 'family') throw forbidden('Только владелец семейного кошелька создаёт приглашения')
    const token = randomToken(24); const expiresAt = addDays(new Date(), 1); await this.pool.query(`INSERT INTO workspace_invites (workspace_id,created_by_user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)`, [workspaceId, userId, hashToken(token), expiresAt]); return { token, expiresAt: expiresAt.toISOString() }
  }

  async acceptInvite(userId: string, token: string) {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); const result = await client.query(`SELECT id,workspace_id,used_at,expires_at FROM workspace_invites WHERE token_hash=$1 FOR UPDATE`, [hashToken(token)]); const invite = result.rows[0]; if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) throw conflict('Приглашение недействительно или уже использовано'); await client.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [invite.workspace_id, userId]); await client.query(`INSERT INTO account_members (account_id,user_id,role) SELECT id,$2,'editor' FROM accounts WHERE workspace_id=$1 AND archived_at IS NULL ON CONFLICT DO NOTHING`, [invite.workspace_id, userId]); await client.query(`UPDATE workspace_invites SET used_at=now(),used_by_user_id=$2 WHERE id=$1`, [invite.id, userId]); await client.query('COMMIT'); return { workspaceId: invite.workspace_id as string } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  async removeMember(userId: string, workspaceId: string, memberUserId: string) {
    const member = await this.assertMember(this.pool, userId, workspaceId)
    if (member.role !== 'owner') throw forbidden('Только владелец управляет участниками')
    if (userId === memberUserId) throw forbidden('Владелец не может удалить себя')
    await this.pool.query(`DELETE FROM account_members am USING accounts a WHERE am.account_id=a.id AND a.workspace_id=$1 AND am.user_id=$2 AND am.role='editor'`, [workspaceId, memberUserId])
    await this.pool.query(`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='member'`, [workspaceId, memberUserId])
    await this.repairActiveAccount(memberUserId)
  }
  async reminderSettings(userId: string) {
    const result = await this.pool.query(
      `SELECT enabled, local_time, days_of_week FROM reminders WHERE user_id=$1`, [userId])
    const row = result.rows[0]
    if (!row) return { enabled: false, localTime: '20:00', daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }
    return {
      enabled: row.enabled as boolean,
      localTime: String(row.local_time).slice(0, 5),
      daysOfWeek: (row.days_of_week as number[]).slice().sort(),
    }
  }

  async saveReminderSettings(userId: string, input: ReminderSettingsInput) {
    // The reminder follows the person's own clock, so it takes the time zone
    // their app is currently reporting rather than one set separately.
    await this.pool.query(
      `INSERT INTO reminders (user_id, enabled, timezone, local_time, days_of_week, updated_at)
       VALUES ($1,$2,COALESCE((SELECT timezone FROM users WHERE id=$1),'Europe/Moscow'),$3,$4,now())
       ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled, timezone=EXCLUDED.timezone,
         local_time=EXCLUDED.local_time, days_of_week=EXCLUDED.days_of_week, updated_at=now()`,
      [userId, input.enabled, input.localTime, input.daysOfWeek])
    return this.reminderSettings(userId)
  }

  /**
   * Everyone a reminder could go to tonight. Whether it actually goes is worked
   * out per person in `reminderDueAt`, because the rules depend on their own
   * time zone and on what they recorded today.
   */
  async reminderCandidates(): Promise<ReminderCandidate[]> {
    const result = await this.pool.query(
      `SELECT r.user_id, u.telegram_user_id, r.timezone, r.local_time, r.days_of_week,
              (SELECT MAX(t.occurred_at) FROM transactions t
                 WHERE t.created_by_user_id=r.user_id AND t.deleted_at IS NULL) AS last_entry_at,
              (SELECT count(*) FROM reminder_deliveries d
                 WHERE d.user_id=r.user_id AND d.kind='daily' AND d.delivered_at IS NOT NULL) AS delivered_count,
              (SELECT MAX(d.delivered_at) FROM reminder_deliveries d
                 WHERE d.user_id=r.user_id) AS last_delivery_at
         FROM reminders r JOIN users u ON u.id=r.user_id
        WHERE r.enabled AND u.deleted_at IS NULL AND u.bot_write_access
        LIMIT 5000`)
    return result.rows.map((row) => ({
      userId: row.user_id as string,
      telegramUserId: Number(row.telegram_user_id),
      timezone: row.timezone as string,
      localTime: String(row.local_time).slice(0, 5),
      daysOfWeek: row.days_of_week as number[],
      lastEntryAt: row.last_entry_at ? new Date(row.last_entry_at as string) : null,
      deliveredCount: Number(row.delivered_count),
      lastDeliveryAt: row.last_delivery_at ? new Date(row.last_delivery_at as string) : null,
    }))
  }

  async sharedActivitySince(userId: string, since: Date): Promise<SharedActivity | null> {
    // The wallet this person is actually looking at, and only if it is shared.
    const account = await this.pool.query(
      `SELECT a.id, a.name FROM users u
         JOIN accounts a ON a.id=u.active_account_id AND a.archived_at IS NULL
        WHERE u.id=$1 AND (SELECT count(*) FROM account_members m WHERE m.account_id=a.id) > 1`, [userId])
    if (!account.rowCount) return null

    const rows = await this.pool.query(
      `SELECT COALESCE(u.first_name,'Участник') AS name, u.id=$1 AS is_self,
              count(*)::int AS entries, SUM(t.amount_kopecks)::bigint AS total
         FROM transactions t LEFT JOIN users u ON u.id=t.created_by_user_id
        WHERE t.account_id=$2 AND t.deleted_at IS NULL AND t.type='expense' AND t.created_at >= $3
        GROUP BY u.id, u.first_name
        ORDER BY total DESC`, [userId, account.rows[0].id, since])
    const byAuthor = rows.rows.map((row) => ({
      name: row.name as string,
      count: Number(row.entries),
      amountKopecks: Number(row.total),
      isSelf: Boolean(row.is_self),
    }))
    // Nothing from anybody else is not news.
    if (!byAuthor.some((item) => !item.isSelf)) return null
    return { accountName: account.rows[0].name as string, byAuthor }
  }

  /** The unique index on (user, kind, scheduled_for) is what stops a second send. */
  async claimDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date) {
    const result = await this.pool.query(
      `INSERT INTO reminder_deliveries (user_id, kind, scheduled_for) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, kind, scheduled_for) DO NOTHING`, [userId, kind, scheduledFor])
    return result.rowCount === 1
  }

  async settleDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date, error?: string) {
    if (!error) {
      await this.pool.query(
        `UPDATE reminder_deliveries SET delivered_at=now() WHERE user_id=$1 AND kind=$2 AND scheduled_for=$3`, [userId, kind, scheduledFor])
      return
    }
    await this.pool.query(
      `UPDATE reminder_deliveries SET error=$4 WHERE user_id=$1 AND kind=$2 AND scheduled_for=$3`, [userId, kind, scheduledFor, error])
  }

  async releaseDelivery(userId: string, kind: DeliveryKind, scheduledFor: Date) {
    await this.pool.query(
      `DELETE FROM reminder_deliveries WHERE user_id=$1 AND kind=$2 AND scheduled_for=$3 AND delivered_at IS NULL`, [userId, kind, scheduledFor])
  }

  /** Called when Telegram says the chat is gone for good. */
  async revokeBotWriteAccess(telegramUserId: number) {
    await this.pool.query(
      `UPDATE users SET bot_write_access=false,updated_at=now() WHERE telegram_user_id=$1`, [telegramUserId])
  }

  async runWorkerBatch() {
    const expired = await this.pool.query(`UPDATE media_objects SET deleted_at=now() WHERE deleted_at IS NULL AND expires_at<=now() RETURNING id`)
    // Telegram stops retrying an update long before a day is out, so older rows
    // only keep the deduplication table growing.
    const forgotten = await this.pool.query(`DELETE FROM processed_telegram_updates WHERE processed_at < now() - interval '1 day'`)
    return { expiredMedia: expired.rowCount || 0, forgottenUpdates: forgotten.rowCount || 0 }
  }

  async health() { await this.pool.query('SELECT 1'); return { database: 'ok' as const } }
  async close() { await this.pool.end() }

  private async transactionPageRows(workspaceId: string, range: { start: Date; end: Date }, rawCursor?: string, requestedLimit = 20, accountIds?: string[]): Promise<TransactionPage> {
    const cursor = decodeTransactionCursor(rawCursor)
    const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
    const values: unknown[] = [workspaceId, range.start, range.end, accountIds || []]
    const after = cursor
      ? `AND (t.occurred_at < $5 OR (t.occurred_at = $5 AND t.id < $6::uuid))`
      : ''
    if (cursor) values.push(cursor.occurredAt, cursor.id)
    values.push(limit + 1)
    const limitIndex = values.length
    const result = await this.pool.query(`SELECT t.*,COALESCE(u.first_name,'Удалённый участник') AS author_name
      FROM transactions t LEFT JOIN users u ON u.id=t.created_by_user_id
      WHERE t.workspace_id=$1 AND t.deleted_at IS NULL AND t.occurred_at BETWEEN $2 AND $3
        AND (cardinality($4::uuid[])=0 OR t.account_id=ANY($4::uuid[]) OR t.target_account_id=ANY($4::uuid[])) ${after}
      ORDER BY t.occurred_at DESC,t.id DESC LIMIT $${limitIndex}`, values)
    const items = result.rows.slice(0, limit).map(transactionRow)
    const last = items.at(-1)
    return {
      items,
      nextCursor: result.rows.length > limit && last ? encodeTransactionCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    }
  }

  private async seedWorkspace(client: PoolClient, workspaceId: string, ownerUserId: string) {
    const account = await client.query(`INSERT INTO accounts (workspace_id,name,kind,icon,color,opening_balance_kopecks) VALUES ($1,'Кошелёк','cash','wallet',$2,0) RETURNING id`, [workspaceId, DATA_COLORS.accountDefault])
    const accountId = account.rows[0].id as string
    await client.query(`INSERT INTO account_members (account_id,user_id,role) VALUES ($1,$2,'owner')`, [accountId, ownerUserId])
    for (const [order, [name, icon, color]] of expenseCategories.entries()) await client.query(`INSERT INTO categories (workspace_id,type,name,icon,color,sort_order) VALUES ($1,'expense',$2,$3,$4,$5)`, [workspaceId, name, icon, color, order])
    for (const [order, [name, icon, color]] of incomeCategories.entries()) await client.query(`INSERT INTO categories (workspace_id,type,name,icon,color,sort_order) VALUES ($1,'income',$2,$3,$4,$5)`, [workspaceId, name, icon, color, order])
    return accountId
  }
  private async assertAccountAccess(queryable: Queryable, userId: string, accountId: string) {
    const result = await queryable.query(`SELECT am.role,a.workspace_id,a.version FROM account_members am JOIN accounts a ON a.id=am.account_id JOIN workspaces w ON w.id=a.workspace_id WHERE am.user_id=$1 AND am.account_id=$2 AND a.archived_at IS NULL AND w.deleted_at IS NULL`, [userId, accountId])
    if (!result.rowCount) throw forbidden('Нет доступа к этому кошельку')
    return { role: result.rows[0].role as 'owner' | 'editor', workspaceId: result.rows[0].workspace_id as string, version: Number(result.rows[0].version) }
  }
  private async assertWorkspaceOwner(queryable: Queryable, userId: string, workspaceId: string) {
    const result = await queryable.query(`SELECT 1 FROM workspaces WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`, [workspaceId, userId])
    if (!result.rowCount) throw forbidden('Только владелец управляет структурой кошелька')
  }
  private async repairActiveAccount(userId: string, lostAccountId?: string) {
    const current = await this.pool.query(`SELECT active_account_id FROM users WHERE id=$1`, [userId])
    if (lostAccountId && current.rows[0]?.active_account_id !== lostAccountId) return
    if (!lostAccountId && current.rows[0]?.active_account_id) {
      const stillAccessible = await this.pool.query(`SELECT 1 FROM account_members am JOIN accounts a ON a.id=am.account_id WHERE am.user_id=$1 AND am.account_id=$2 AND a.archived_at IS NULL`, [userId, current.rows[0].active_account_id])
      if (stillAccessible.rowCount) return
    }
    const fallback = await this.pool.query(`SELECT a.id,a.workspace_id FROM account_members am JOIN accounts a ON a.id=am.account_id WHERE am.user_id=$1 AND a.archived_at IS NULL ORDER BY CASE am.role WHEN 'owner' THEN 0 ELSE 1 END,a.created_at LIMIT 1`, [userId])
    await this.pool.query(`UPDATE users SET active_account_id=$2,active_workspace_id=$3,updated_at=now() WHERE id=$1`, [userId, fallback.rows[0]?.id || null, fallback.rows[0]?.workspace_id || null])
  }
  private async assertMember(queryable: Queryable, userId: string, workspaceId: string) { const result = await queryable.query(`SELECT wm.role,w.kind FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=$1 AND wm.workspace_id=$2 AND w.deleted_at IS NULL`, [userId, workspaceId]); if (!result.rowCount) throw forbidden('Нет доступа к этому пространству'); return result.rows[0] as { role: 'owner' | 'member'; kind: 'personal' | 'family' } }
  private async assertCategoryParent(queryable: Queryable, workspaceId: string, type: CategoryView['type'], parentId: string | null, categoryId?: string) {
    if (!parentId) return
    if (parentId === categoryId) throw conflict('Категория не может быть родительской для самой себя')
    const result = await queryable.query(`WITH RECURSIVE ancestry AS (SELECT id,parent_id,type,workspace_id FROM categories WHERE id=$1 AND archived_at IS NULL UNION ALL SELECT c.id,c.parent_id,c.type,c.workspace_id FROM categories c JOIN ancestry a ON c.id=a.parent_id WHERE c.archived_at IS NULL) SELECT * FROM ancestry`, [parentId])
    const parent = result.rows[0]
    if (!parent || parent.workspace_id !== workspaceId || parent.type !== type) throw conflict('Родительская категория должна быть того же типа')
    if (categoryId && result.rows.some((row) => row.id === categoryId)) throw conflict('Нельзя создать цикл категорий')
  }
  private async validateRelations(queryable: Queryable, workspaceId: string, input: Pick<TransactionInput, 'accountId' | 'targetAccountId' | 'categoryId'>) { const accountIds = [input.accountId, input.targetAccountId].filter(Boolean); const accounts = await queryable.query(`SELECT id FROM accounts WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL`, [workspaceId, accountIds]); if (accounts.rowCount !== accountIds.length) throw forbidden('Счёт принадлежит другому пространству или архивирован'); if (input.categoryId) { const category = await queryable.query(`SELECT id FROM categories WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL`, [workspaceId, input.categoryId]); if (!category.rowCount) throw forbidden('Категория принадлежит другому пространству или архивирована') } }
  private async archiveEntity(userId: string, table: 'accounts' | 'categories', id: string, version: number) { const found = await this.pool.query(`SELECT workspace_id,version FROM ${table} WHERE id=$1 AND archived_at IS NULL`, [id]); if (!found.rowCount) throw notFound(); await this.assertWorkspaceOwner(this.pool, userId, found.rows[0].workspace_id); if (found.rows[0].version !== version) throw conflict(); await this.pool.query(`UPDATE ${table} SET archived_at=now(),updated_at=now(),version=version+1 WHERE id=$1`, [id]) }
  private async audit(client: PoolClient, workspaceId: string, userId: string, entityType: string, entityId: string, action: string, data: unknown) { await client.query(`INSERT INTO audit_log (workspace_id,actor_user_id,entity_type,entity_id,action,data) VALUES ($1,$2,$3,$4,$5,$6)`, [workspaceId, userId, entityType, entityId, action, JSON.stringify(data)]) }
}

function userRow(row: Record<string, unknown>): SessionUser { return { id: row.id as string, firstName: row.first_name as string, username: row.username as string | null, timezone: row.timezone as string } }
function accountRow(row: Record<string, unknown>): AccountView { return { id: row.id as string, workspaceId: row.workspace_id as string, name: row.name as string, kind: row.kind as AccountView['kind'], icon: row.icon as string, color: row.color as string, openingBalanceKopecks: Number(row.opening_balance_kopecks), balanceKopecks: 0, version: row.version as number, archivedAt: row.archived_at ? new Date(row.archived_at as string).toISOString() : null, accessRole: (row.access_role as AccountView['accessRole']) || 'owner', memberCount: Number(row.member_count || 1) } }
function categoryRow(row: Record<string, unknown>): CategoryView { return { id: row.id as string, type: row.type as CategoryView['type'], name: row.name as string, icon: row.icon as string, color: row.color as string, parentId: row.parent_id as string | null, order: Number(row.sort_order), version: row.version as number, archivedAt: row.archived_at ? new Date(row.archived_at as string).toISOString() : null, usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count) } }
function transactionRow(row: Record<string, unknown>): TransactionView { return { id: row.id as string, type: row.type as TransactionView['type'], amountKopecks: Number(row.amount_kopecks), accountId: row.account_id as string, targetAccountId: row.target_account_id as string | null, categoryId: row.category_id as string | null, occurredAt: new Date(row.occurred_at as string).toISOString(), note: row.note as string, source: row.source as TransactionView['source'], authorName: row.author_name as string, version: row.version as number, categoryGuessed: Boolean(row.category_guessed) } }
function summaryFromSql(
  totals: Record<string, unknown>,
  categories: Array<Record<string, unknown>>,
  trend: Array<Record<string, unknown>>,
  range: { start: Date; end: Date },
  byMonth: boolean,
  timeZone: string,
): DashboardSummary {
  const incomeKopecks = Number(totals.income)
  const expenseKopecks = Number(totals.expense)
  const cutoff = new Date() < range.end ? new Date() : range.end
  const elapsedDays = Math.max(1, zonedDayNumber(cutoff, timeZone) - zonedDayNumber(range.start, timeZone) + 1)
  const firstObservedDay = typeof totals.first_observed_day === 'string'
    ? dayNumberFromKey(totals.first_observed_day)
    : null
  const lastDay = zonedDayNumber(cutoff, timeZone)
  const observedDayCount = firstObservedDay === null ? 0 : Math.max(0, lastDay - firstObservedDay + 1)
  const categoryItems = categories.map((row) => ({
    categoryId: row.category_id as string | null,
    name: row.name as string,
    color: row.color as string,
    icon: row.icon as string | null,
    amountKopecks: Number(row.amount),
    type: row.type as 'income' | 'expense',
  }))
  const mostFrequentExpense = categories
    .filter((row) => row.type === 'expense')
    .sort((left, right) => Number(right.count) - Number(left.count)
      || String(left.category_id ?? '').localeCompare(String(right.category_id ?? '')))[0]
  const expenseDays = new Set(((totals.expense_days as string[] | null) ?? []).map((value) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year!, month! - 1, day!) / 86_400_000
  }))
  let expenseFreeStreakDays = 0
  let currentExpenseFreeStreakDays = 0
  if (firstObservedDay !== null) {
    for (let day = firstObservedDay; day <= lastDay; day += 1) {
      currentExpenseFreeStreakDays = expenseDays.has(day) ? 0 : currentExpenseFreeStreakDays + 1
      expenseFreeStreakDays = Math.max(expenseFreeStreakDays, currentExpenseFreeStreakDays)
    }
  }
  return {
    periodStart: range.start.toISOString(),
    periodEnd: range.end.toISOString(),
    granularity: byMonth ? 'month' : 'day',
    elapsedDays,
    observedDayCount,
    netKopecks: incomeKopecks - expenseKopecks,
    incomeKopecks,
    expenseKopecks,
    averageExpensePerDayKopecks: Math.round(expenseKopecks / elapsedDays),
    largestExpenseKopecks: Number(totals.largest_expense),
    largestExpenseCategoryId: totals.largest_expense_category_id as string | null,
    largestIncomeKopecks: Number(totals.largest_income),
    largestIncomeCategoryId: totals.largest_income_category_id as string | null,
    mostExpensiveDayKopecks: Number(totals.most_expensive_day_amount),
    mostExpensiveDay: totals.most_expensive_day as string | null,
    expenseFreeStreakDays,
    weekendExpenseSharePercent: expenseKopecks ? Math.round((Number(totals.weekend_expense) / expenseKopecks) * 100) : 0,
    operationCount: Number(totals.operation_count),
    mostFrequentExpenseCategoryId: (mostFrequentExpense?.category_id as string | null | undefined) ?? null,
    mostFrequentExpenseCategoryCount: Number(mostFrequentExpense?.count ?? 0),
    byCategory: categoryItems,
    trend: trend.map((row) => ({ date: row.bucket as string, incomeKopecks: Number(row.income), expenseKopecks: Number(row.expense) })),
  }
}

function dayNumberFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year!, month! - 1, day!) / 86_400_000
}
