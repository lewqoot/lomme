// Design preview harness — renders the real App against a mocked API so the UI
// can be compared with the reference screenshots without a database.
// Not part of the production bundle; delete once the design work is done.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { endOfMonth, startOfMonth } from 'date-fns'
import {
  type AppSnapshot,
  type CategoryView,
  type CreateCategoryInput,
  type CreateTransactionInput,
  type ReorderCategoriesInput,
  type TransactionView,
  type UpdateCategoryInput,
} from './shared/contracts'
import { calculateSummary } from './shared/summary'
import { initTelegram, isTelegram, webApp } from './lib/telegram'
import { DATA_COLORS } from './shared/design-tokens'
import { expenseCategories as expenseCategorySeeds, incomeCategories as incomeCategorySeeds } from './shared/default-categories'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const accountId = '00000000-0000-4000-8000-000000000002'

const expenseIds = ['c7', 'c5', 'c13', 'c4', 'c3', 'c8', 'c6', 'c2', 'c9', 'c10', 'c14', 'c1'] as const
const incomeIds = ['c11', 'c15', 'c16', 'c17', 'c12', 'c18', 'c19', 'c20', 'c21'] as const
const categories = expenseCategorySeeds.map(([name, icon, color], order) => ({ id: expenseIds[order], name, icon, color, type: 'expense' as const, parentId: null, order, version: 1, archivedAt: null }))
const incomeCategories = incomeCategorySeeds.map(([name, icon, color], order) => ({ id: incomeIds[order], name, icon, color, type: 'income' as const, parentId: null, order, version: 1, archivedAt: null }))

let previewCategories: CategoryView[] = [...categories, ...incomeCategories]

/**
 * Deterministic mock data spanning several months, so the period switcher, the
 * charts and the analytics all have something different to show.
 */
const iso = (year: number, month: number, day: number, hour: number) =>
  new Date(Date.UTC(year, month, day, hour, 30)).toISOString()

type Seed = { day: number; hour: number; type: 'income' | 'expense'; amount: number; category: string | null }

const MONTHS: Record<string, Seed[]> = {}
const now = new Date()

// Each month gets its own spending pattern rather than a repeat of the same rows.
// Enough rows per month that the streak / weekend / frequency tiles have real input.
const PATTERNS: Seed[][] = [
  [
    // The exact 00:01 reference state: 200 000 income, 21 992 expense,
    // 178 008 net. Keeping these rows literal makes Home and Insights comparable
    // by data as well as by geometry.
    { day: 24, hour: 17, type: 'income', amount: 100_000, category: null },
    { day: 24, hour: 16, type: 'expense', amount: 5_999, category: 'c6' },
    { day: 24, hour: 15, type: 'income', amount: 50_000, category: null },
    { day: 24, hour: 14, type: 'expense', amount: 4_708, category: 'c2' },
    { day: 24, hour: 13, type: 'expense', amount: 5_580, category: 'c3' },
    { day: 22, hour: 16, type: 'income', amount: 50_000, category: null },
    { day: 22, hour: 15, type: 'expense', amount: 5_000, category: null },
    { day: 22, hour: 14, type: 'expense', amount: 555, category: 'c4' },
    { day: 22, hour: 13, type: 'expense', amount: 150, category: 'c5' },
  ],
  [
    { day: 2, hour: 12, type: 'income', amount: 180_000, category: 'c11' },
    { day: 2, hour: 16, type: 'income', amount: 34_500, category: 'c12' },
    { day: 3, hour: 9, type: 'expense', amount: 42_800, category: 'c2' },
    { day: 4, hour: 20, type: 'expense', amount: 2_310, category: 'c5' },
    { day: 6, hour: 21, type: 'expense', amount: 8_450, category: 'c5' },
    { day: 7, hour: 8, type: 'expense', amount: 810, category: 'c6' },
    { day: 9, hour: 15, type: 'expense', amount: 61_200, category: 'c10' },
    { day: 10, hour: 13, type: 'expense', amount: 3_940, category: 'c7' },
    { day: 13, hour: 10, type: 'expense', amount: 14_300, category: 'c7' },
    { day: 14, hour: 19, type: 'expense', amount: 1_120, category: 'c6' },
    { day: 16, hour: 12, type: 'expense', amount: 5_600, category: 'c3' },
    { day: 17, hour: 18, type: 'expense', amount: 4_100, category: 'c4' },
    { day: 20, hour: 8, type: 'expense', amount: 2_760, category: 'c6' },
    { day: 21, hour: 14, type: 'expense', amount: 7_450, category: 'c7' },
    { day: 23, hour: 20, type: 'expense', amount: 3_180, category: 'c4' },
    { day: 26, hour: 12, type: 'expense', amount: 19_900, category: 'c9' },
    { day: 28, hour: 17, type: 'expense', amount: 2_240, category: 'c8' },
  ],
  [
    { day: 1, hour: 12, type: 'income', amount: 180_000, category: 'c11' },
    { day: 2, hour: 18, type: 'expense', amount: 2_050, category: 'c5' },
    { day: 5, hour: 9, type: 'expense', amount: 42_800, category: 'c2' },
    { day: 6, hour: 11, type: 'expense', amount: 1_430, category: 'c6' },
    { day: 7, hour: 13, type: 'expense', amount: 23_400, category: 'c7' },
    { day: 9, hour: 20, type: 'expense', amount: 5_120, category: 'c4' },
    { day: 11, hour: 19, type: 'expense', amount: 6_700, category: 'c5' },
    { day: 12, hour: 8, type: 'expense', amount: 940, category: 'c6' },
    { day: 14, hour: 16, type: 'expense', amount: 31_000, category: 'c3' },
    { day: 16, hour: 12, type: 'income', amount: 21_000, category: 'c12' },
    { day: 18, hour: 15, type: 'expense', amount: 8_260, category: 'c7' },
    { day: 19, hour: 20, type: 'expense', amount: 3_300, category: 'c4' },
    { day: 22, hour: 8, type: 'expense', amount: 2_150, category: 'c6' },
    { day: 23, hour: 14, type: 'expense', amount: 12_800, category: 'c10' },
    { day: 25, hour: 19, type: 'expense', amount: 1_780, category: 'c5' },
    { day: 27, hour: 11, type: 'expense', amount: 8_800, category: 'c8' },
    { day: 29, hour: 13, type: 'expense', amount: 5_400, category: 'c9' },
  ],
]

for (let back = 0; back < 14; back += 1) {
  const date = new Date(now.getFullYear(), now.getMonth() - back, 1)
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const pattern = PATTERNS[back % PATTERNS.length]
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const today = back === 0 ? now.getDate() : lastDay
  MONTHS[key] = pattern
    .filter((seed) => seed.day <= today)
    .map((seed, index) => ({
      ...seed,
      amount: back === 0 ? seed.amount : Math.round(seed.amount * (1 + ((back * 7 + index * 3) % 11) / 100)),
    }))
}

/** Every seeded month flattened into one ledger; requests just slice a window out. */
const BASE_TRANSACTIONS: TransactionView[] = Object.entries(MONTHS).flatMap(([period, seeds]) => {
  const [year, month] = period.split('-').map(Number)
  return seeds.map((seed, index) => ({
    id: `${period}-${index}`,
    type: seed.type,
    amountKopecks: seed.amount * 100,
    accountId,
    targetAccountId: null,
    categoryId: seed.category,
    occurredAt: iso(year, month - 1, seed.day, seed.hour),
    note: '',
    source: 'manual' as const,
    authorName: 'Alex',
    version: 1,
  }))
}).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))

const baseLedgerKopecks = BASE_TRANSACTIONS.reduce(
  (sum, item) => sum + (item.type === 'income' ? item.amountKopecks : -item.amountKopecks), 0)
const openingBalanceKopecks = 17_800_800 - baseLedgerKopecks
let previewTransactions = BASE_TRANSACTIONS.slice()

// Later reference chapters start after the two operations created in the video.
// A query fixture makes those chapters independently reproducible without first
// replaying a minute of unrelated UI in every screenshot test.
const fixture = new URLSearchParams(location.search).get('fixture')
if (fixture === 'post-expense' || fixture === 'post-income') {
  previewTransactions.unshift({
    id: 'fixture-expense', type: 'expense', amountKopecks: 5_000, accountId,
    targetAccountId: null, categoryId: 'c7', occurredAt: iso(now.getFullYear(), now.getMonth(), 26, 11),
    note: 'Еда', source: 'manual', authorName: 'Alex', version: 1,
  })
}
if (fixture === 'post-income') {
  previewTransactions.unshift({
    id: 'fixture-income', type: 'income', amountKopecks: 10_000_000, accountId,
    targetAccountId: null, categoryId: 'c11', occurredAt: iso(now.getFullYear(), now.getMonth(), 26, 12),
    note: '', source: 'manual', authorName: 'Alex', version: 1,
  })
}

/**
 * Live mode: start with an empty ledger and keep whatever gets entered, so the app
 * can be used against real numbers instead of the reference fixture. `?demo` brings
 * the seeded data back, `?reset` wipes what was saved.
 *
 * State lives in localStorage, which is per-device and never leaves the browser.
 */
const STORE_KEY = 'lomme-preview-v1'
type SavedState = { transactions: TransactionView[]; categories: CategoryView[]; opening: number }

const params = new URLSearchParams(location.search)
const demoMode = params.has('demo')
if (params.get('telegram') === 'expanded') {
  document.documentElement.classList.add('in-telegram')
  document.documentElement.style.setProperty('--tg-js-safe-top', '88px')
}
let previewQuickKeyActive = params.get('shortcut') === 'active'
if (params.has('reset')) localStorage.removeItem(STORE_KEY)

const save = () => {
  if (demoMode) return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      transactions: previewTransactions, categories: previewCategories,
      opening: previewOpeningKopecks,
    } satisfies SavedState))
  } catch { /* private mode or full quota - the session simply is not remembered */ }
}

let previewOpeningKopecks = openingBalanceKopecks
if (!demoMode) {
  const raw = (() => { try { return localStorage.getItem(STORE_KEY) } catch { return null } })()
  if (raw) {
    try {
      const saved = JSON.parse(raw) as SavedState
      previewTransactions = saved.transactions ?? []
      previewCategories = saved.categories ?? previewCategories
      previewOpeningKopecks = saved.opening ?? 0
    } catch { previewTransactions = [] }
  } else {
    // First run in live mode: nothing entered yet, so nothing to show.
    previewTransactions = []
    previewOpeningKopecks = 0
  }
}

// Older preview wallets only had Salary and Gifts. Fill the new income strip by
// semantic name without replacing or reordering anything the user created.
const incomeNames = new Set(previewCategories.filter((item) => item.type === 'income').map((item) => item.name))
const nextIncomeOrder = Math.max(-1, ...previewCategories.filter((item) => item.type === 'income').map((item) => item.order)) + 1
previewCategories = [
  ...previewCategories,
  ...incomeCategories.filter((item) => !incomeNames.has(item.name)).map((item, index) => ({ ...item, order: nextIncomeOrder + index })),
]

const buildSnapshot = (start: Date, end: Date): AppSnapshot => {
  const transactions = previewTransactions.filter((item) => {
    const at = new Date(item.occurredAt)
    return at >= start && at <= end
  })
  const balance = previewTransactions.reduce(
    (sum, item) => sum + (item.type === 'income' ? item.amountKopecks : item.type === 'expense' ? -item.amountKopecks : 0), previewOpeningKopecks)
  const categoryUsage = new Map<string, number>()
  for (const item of previewTransactions) if (item.categoryId) categoryUsage.set(item.categoryId, (categoryUsage.get(item.categoryId) ?? 0) + 1)

  return {
    user: { id: 'u1', firstName: 'Alex', username: 'alex', timezone: 'Europe/Moscow', theme: 'system' },
    workspaces: [{ id: workspaceId, name: 'Личный', kind: 'personal', role: 'owner' }],
    activeWorkspaceId: workspaceId,
    activeAccountId: accountId,
    accounts: [{ id: accountId, workspaceId, name: fixture === 'shared-wallet' ? 'Кошелёк 1' : 'Кошелек', kind: 'cash', icon: 'wallet', color: DATA_COLORS.accountDefault, openingBalanceKopecks: previewOpeningKopecks, balanceKopecks: balance, version: 1, archivedAt: null, accessRole: 'owner', memberCount: fixture === 'shared-wallet' ? 2 : 1 }],
    categories: previewCategories.map((item) => ({ ...item, usageCount: categoryUsage.get(item.id) ?? 0 })),
    transactions,
    transactionsNextCursor: null,
    members: fixture === 'shared-wallet'
      ? [{ userId: 'u1', firstName: 'Alex', username: 'alex', role: 'owner' }, { userId: 'u2', firstName: 'Ирина', username: 'irina', role: 'editor' }]
      : [{ userId: 'u1', firstName: 'Alex', username: 'alex', role: 'owner' }],
    // The very same function the API runs, so the preview cannot drift from production.
    summary: calculateSummary(transactions, previewCategories, { start, end }),
  }
}

const realFetch = window.fetch.bind(window)

const LIVE_APP_URL = 'https://lomme-production.up.railway.app'
const MIGRATION_KEY = 'lomme-preview-railway-migration-v1'
const liveAppLaunchUrl = () => `${LIVE_APP_URL}${location.search}${location.hash}`

/**
 * The preview was accidentally exposed as the bot's Mini App. Before it sends a
 * real Telegram user into the production app, carry their on-device ledger over
 * once. IDs make the server import idempotent, so a refresh cannot duplicate an
 * operation; the marker simply avoids a needless repeat request.
 */
async function migratePreviewToRailway(): Promise<boolean> {
  const initData = webApp()?.initData
  if (demoMode || !isTelegram() || !initData) return false
  const categoryNames = new Map(previewCategories
    .filter((category) => !category.archivedAt)
    .map((category) => [category.id, category]))
  const entries = previewTransactions
    .filter((transaction) => transaction.type === 'expense' || transaction.type === 'income')
    .map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amountKopecks: transaction.amountKopecks,
      categoryId: transaction.categoryId,
      occurredAt: transaction.occurredAt,
      note: transaction.note,
    }))
  const fingerprint = JSON.stringify(entries.map((entry) => [entry.id, entry.amountKopecks, entry.occurredAt, entry.note]))
  let alreadyMigrated = false
  try { alreadyMigrated = localStorage.getItem(MIGRATION_KEY) === fingerprint } catch { /* migration can still run */ }
  try {
    if (!alreadyMigrated) {
      const response = await realFetch(`${LIVE_APP_URL}/api/v1/migrations/design-preview`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initData,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
          categories: [...categoryNames.values()].map(({ id, type, name, icon, color }) => ({ id, type, name, icon, color })),
          entries,
          openingBalanceKopecks: previewOpeningKopecks,
        }),
      })
      if (!response.ok) return false
      try { localStorage.setItem(MIGRATION_KEY, fingerprint) } catch { /* no persistent marker needed */ }
    }
    // Telegram carries signed launch data in the URL in several clients. Keep it
    // during the hand-off so the production app can create the same user session.
    window.location.replace(liveAppLaunchUrl())
    return true
  } catch {
    // Keep the preview usable if a network is temporarily unavailable; its next
    // open retries the same idempotent migration before redirecting.
    return false
  }
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url)
  const requestUrl = new URL(url, location.origin)
  const path = requestUrl.pathname
  if (!path.startsWith('/api/')) return realFetch(input as RequestInfo, init)
  if (path.endsWith('/api/v1/quick-key/status')) {
    return Response.json({ active: previewQuickKeyActive })
  }
  if (path.endsWith('/api/v1/quick-key') && init?.method === 'POST') {
    const replace = (JSON.parse(String(init.body || '{}')) as { replace?: unknown }).replace === true
    if (previewQuickKeyActive && !replace) {
      return Response.json({ error: { code: 'QUICK_KEY_EXISTS', message: 'Личный ключ уже активен' } }, { status: 409 })
    }
    previewQuickKeyActive = true
    return Response.json({ key: 'lom_preview_only_not_a_real_key' }, { status: 201 })
  }
  if (path.endsWith('/api/v1/account-invites/preview') && init?.method === 'POST') {
    return Response.json({ accountId, accountName: 'Домашний кошелёк', inviterName: 'Alex', status: 'active', expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  }
  if (path.endsWith('/api/v1/account-invites/accept') && init?.method === 'POST') {
    return Response.json({ workspaceId, accountId })
  }
  if (path.endsWith('/api/v1/transactions') && init?.method === 'POST') {
    const payload = JSON.parse(String(init.body)) as CreateTransactionInput
    const id = crypto.randomUUID()
    previewTransactions = [{
      id, type: payload.type, amountKopecks: payload.amountKopecks, accountId: payload.accountId,
      targetAccountId: payload.targetAccountId || null, categoryId: payload.categoryId || null,
      occurredAt: payload.occurredAt, note: payload.note, source: payload.source,
      authorName: 'Alex', version: 1,
    }, ...previewTransactions]
    save()
    return Response.json({ id }, { status: 201 })
  }
  const transactionId = path.match(/\/api\/v1\/transactions\/([^/]+)$/)?.[1]
  if (transactionId && init?.method === 'PUT') {
    const payload = JSON.parse(String(init.body)) as Omit<CreateTransactionInput, 'workspaceId' | 'source'> & { version: number }
    previewTransactions = previewTransactions.map((item) => item.id === transactionId
      ? { ...item, ...payload, targetAccountId: payload.targetAccountId || null, categoryId: payload.categoryId || null, version: item.version + 1 }
      : item)
    save()
    return new Response(null, { status: 204 })
  }
  if (transactionId && init?.method === 'DELETE') {
    previewTransactions = previewTransactions.filter((item) => item.id !== transactionId)
    save()
    return new Response(null, { status: 204 })
  }
  if (path.endsWith('/api/v1/categories/reorder') && init?.method === 'PUT') {
    const payload = JSON.parse(String(init.body)) as ReorderCategoriesInput
    const order = new Map(payload.categoryIds.map((id, index) => [id, index]))
    previewCategories = previewCategories.map((item) => item.type === payload.type && order.has(item.id)
      ? { ...item, order: order.get(item.id)!, version: item.version + 1 }
      : item)
    save()
    return new Response(null, { status: 204 })
  }
  if (path.endsWith('/api/v1/categories') && init?.method === 'POST') {
    const payload = JSON.parse(String(init.body)) as CreateCategoryInput
    const id = crypto.randomUUID()
    const order = Math.max(-1, ...previewCategories.filter((item) => item.type === payload.type && !item.archivedAt).map((item) => item.order)) + 1
    previewCategories = [...previewCategories, {
      id, type: payload.type, name: payload.name, icon: payload.icon, color: payload.color,
      parentId: payload.parentId || null, order, version: 1, archivedAt: null,
    }]
    save()
    return Response.json({ id }, { status: 201 })
  }
  const categoryId = path.match(/\/api\/v1\/categories\/([^/]+)$/)?.[1]
  if (categoryId && init?.method === 'PUT') {
    const payload = JSON.parse(String(init.body)) as UpdateCategoryInput
    previewCategories = previewCategories.map((item) => item.id === categoryId
      ? { ...item, type: payload.type, name: payload.name, icon: payload.icon, color: payload.color, parentId: payload.parentId || null, version: item.version + 1 }
      : item)
    save()
    return new Response(null, { status: 204 })
  }
  if (categoryId && init?.method === 'DELETE') {
    previewCategories = previewCategories.map((item) => item.id === categoryId
      ? { ...item, archivedAt: new Date().toISOString(), version: item.version + 1 }
      : item)
    save()
    return new Response(null, { status: 204 })
  }
  const params = requestUrl.searchParams
  const start = params.get('start') ? new Date(params.get('start')!) : startOfMonth(now)
  const end = params.get('end') ? new Date(params.get('end')!) : endOfMonth(now)
  const body = url.includes('/snapshot') ? buildSnapshot(start, end) : {}
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function mountPreview() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

// The bot still points at this legacy origin. Do not paint its Home screen and
// then replace it a moment later: migrate first, then open production. If that
// request cannot be completed, the preview remains available as a fallback.
void migratePreviewToRailway().then((redirecting) => {
  if (!redirecting) {
    initTelegram()
    mountPreview()
  }
})

// ?screen=<name> drives the app to a screen by clicking its entry point, so each
// reference frame can be compared without hand-navigating the preview.
const ENTRY: Record<string, string> = {
  editor: '.floating-actions button:last-child',
  insights: '.insights-button',
  analytics: '[aria-label="Аналитика"]',
  accounts: '.workspace-picker',
  search: '[aria-label="Поиск"]',
  settings: '[aria-label="Настройки"]',
}
const screen = new URLSearchParams(location.search).get('screen')
if (screen && ENTRY[screen]) {
  const open = () => {
    const target = document.querySelector<HTMLElement>(ENTRY[screen])
    if (target) target.click()
    else requestAnimationFrame(open)
  }
  requestAnimationFrame(open)
}
