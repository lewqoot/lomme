import { existsSync } from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import compress from '@fastify/compress'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError, type ZodType } from 'zod'
import {
  accountInviteSchema,
  activeAccountSchema,
  authTelegramSchema,
  createAccountSchema,
  createCategorySchema,
  createTransactionSchema,
  createWorkspaceSchema,
  inviteTokenSchema,
  legacyPreviewMigrationSchema,
  quickEntrySchema,
  reminderSettingsSchema,
  reorderCategoriesSchema,
  transactionPageQuerySchema,
  updateAccountSchema,
  updateCategorySchema,
  updateTransactionSchema,
  uuidSchema,
} from '../src/shared/contracts.js'
import { parseQuickAmount, parseQuickLine, type QuickRejection } from '../src/shared/quick-entry.js'
import { telegramStartParam, validateTelegramInitData, type TelegramIdentity } from './auth/telegram.js'
import { answerCallbackQuery, editMessage, sendMessage } from './telegram/api.js'
import { accountInviteAccepted } from './telegram/texts.js'
import { confirmation as confirmationFor, routeUpdate, type TelegramUpdate } from './telegram/router.js'
import { AppError } from './lib/errors.js'
import { ensureSameOrigin } from './lib/security.js'
import type { FinanceStore, SessionUser } from './store/types.js'

declare module 'fastify' {
  interface FastifyRequest { currentUser?: SessionUser }
}

const DEFAULT_TELEGRAM_INIT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const DEFAULT_SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/7904d226526a4e64ac8fa14599f065f5'

function telegramInitMaxAgeSeconds() {
  const configured = Number(process.env.TELEGRAM_INIT_MAX_AGE_SECONDS)
  if (Number.isSafeInteger(configured) && configured > 0 && configured <= DEFAULT_TELEGRAM_INIT_MAX_AGE_SECONDS) return configured
  return DEFAULT_TELEGRAM_INIT_MAX_AGE_SECONDS
}

function configuredOrigin(value?: string) {
  if (!value) return null
  try { return new URL(value).origin } catch { return null }
}

function allowedCorsOrigins() {
  const origins = new Set<string>()
  const appOrigin = configuredOrigin(process.env.APP_URL)
  const legacyPreviewOrigin = configuredOrigin(process.env.LEGACY_PREVIEW_URL)
  if (appOrigin) origins.add(appOrigin)
  if (legacyPreviewOrigin) origins.add(legacyPreviewOrigin)
  if (process.env.NODE_ENV !== 'production') {
    for (const port of [4173, 4599, 5173]) {
      origins.add(`http://127.0.0.1:${port}`)
      origins.add(`http://localhost:${port}`)
    }
  }
  return origins
}

function shortcutIcloudUrl() {
  const configured = process.env.VITE_SHORTCUT_ICLOUD_URL?.trim() || DEFAULT_SHORTCUT_ICLOUD_URL
  try {
    const url = new URL(configured)
    if (url.protocol === 'https:' && url.hostname === 'www.icloud.com' && url.pathname.startsWith('/shortcuts/')) return url.href
  } catch { /* fall back to the published Lomme shortcut */ }
  return DEFAULT_SHORTCUT_ICLOUD_URL
}

export function shortcutErrorText(code: string) {
  if (code === 'QUICK_KEY_INVALID' || code === 'QUICK_KEY_MISSING') {
    return '🔑 Ключ больше не работает\nОткрой Lomme → Настройки → Быстрый ввод'
  }
  // The shortcut and the bot reject the same lines for the same reasons, and
  // say so in the same words — only the notification is one line shorter.
  if (code === 'QUICK_GROUPING') return '🤔 Не понял сумму\nРазряды пиши пробелом: 1 234,56 продукты'
  if (code === 'QUICK_SEVERAL_AMOUNTS') return '🤔 В строке два числа\nОставь одно: 1250 такси'
  if (code === 'QUICK_ARITHMETIC') return '🤔 Считать пока не умею\nНапиши итог: 500 такси'
  if (code === 'QUICK_SHORTHAND') return '🤔 Не понял сокращение\nНапиши сумму полностью: 1000 продукты'
  if (code === 'QUICK_INCOME') return 'Это похоже на доход\nДоходы пока добавляются в приложении'
  if (code === 'QUICK_AMOUNT_INVALID' || code === 'VALIDATION_ERROR') {
    return '🤔 Не нашёл сумму\nНапример: 1250 такси'
  }
  if (code === 'RATE_LIMITED') return '⏳ Слишком часто\nПопробуй через минуту'
  return '⚠️ Не записалось\nПопробуй ещё раз'
}

/**
 * Telegram only accepts an https address in a web_app button, so a local run
 * (APP_URL is http there) gets messages without the open-app button instead of
 * a rejected send.
 */
/** Matches the deprecated webhook route, whose path contains the secret. */
const WEBHOOK_PATH_SECRET = /^\/api\/v1\/telegram\/webhook\/[^/?]+/

function telegramWebAppUrl() {
  const value = process.env.APP_URL?.trim()
  return value && value.startsWith('https://') ? value : null
}

/** One rejection, one error code, so both channels can answer identically. */
const REJECTION_CODES: Record<QuickRejection, string> = {
  'no-amount': 'QUICK_AMOUNT_INVALID',
  'several-amounts': 'QUICK_SEVERAL_AMOUNTS',
  grouping: 'QUICK_GROUPING',
  arithmetic: 'QUICK_ARITHMETIC',
  shorthand: 'QUICK_SHORTHAND',
  income: 'QUICK_INCOME',
}

function normalizedBotUsername(value?: string) {
  const username = value?.trim().replace(/^@/, '')
  return username && /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : null
}

export async function buildApp(store: FinanceStore) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH === 'true') {
    throw new Error('ALLOW_DEV_AUTH must be disabled in production')
  }
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        // Telegram's proof that an update is genuine. Logging it would hand
        // anyone with log access the ability to forge updates.
        'req.headers["x-telegram-bot-api-secret-token"]',
        'req.body.note',
        'req.body.text',
        'req.body.token',
        'req.body.initData',
        'req.body.entries.*.note',
      ],
      serializers: {
        req(request) {
          return {
            method: request.method,
            // The deprecated webhook route carries the same secret in its path,
            // so the logged url is the route, never the request's own.
            url: WEBHOOK_PATH_SECRET.test(request.url) ? '/api/v1/telegram/webhook/[secret]' : request.url,
            host: request.headers.host,
            remoteAddress: request.socket?.remoteAddress,
            remotePort: request.socket?.remotePort,
          }
        },
      },
    },
    trustProxy: true,
  })
  let verifiedBotUsername: string | null = null
  const inviteBotUsername = async () => {
    if (verifiedBotUsername) return verifiedBotUsername
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
    if (token) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`)
        const payload = await response.json() as { ok?: boolean; result?: { is_bot?: boolean; username?: string } }
        const username = normalizedBotUsername(payload.ok && payload.result?.is_bot ? payload.result.username : undefined)
        if (!response.ok || !username) throw new Error('Telegram did not return the bot username')
        verifiedBotUsername = username
        return username
      } catch (error) {
        app.log.error({ event: 'account_invite_bot_resolve_failed', error: error instanceof Error ? error.message : 'unknown' }, 'Account invite bot resolution failed')
        throw new AppError(503, 'TELEGRAM_INVITES_UNAVAILABLE', 'Не удалось подготовить ссылку Telegram. Попробуйте ещё раз')
      }
    }
    const configured = normalizedBotUsername(process.env.TELEGRAM_BOT_USERNAME)
    if (!configured) throw new AppError(503, 'TELEGRAM_INVITES_UNAVAILABLE', 'Приглашения Telegram временно недоступны')
    verifiedBotUsername = configured
    return configured
  }
  // Compression hooks have to exist before routes are declared. Registering the
  // plugin next to fastify-static only compressed static files, not JSON APIs.
  await app.register(compress, { threshold: 1_024 })
  await app.register(cookie)
  const corsOrigins = allowedCorsOrigins()
  await app.register(cors, {
    origin: (origin, callback) => callback(null, Boolean(origin && corsOrigins.has(origin))),
    credentials: true,
  })
  await app.register(rateLimit, {
    max: 180,
    timeWindow: '1 minute',
    keyGenerator: async (request) => {
      // Static files, fonts and icons must never turn into session lookups. Keep
      // their rate-limit identity IP-based; API calls may use the authenticated
      // user so one shared Telegram egress IP does not mix unrelated clients.
      if (!request.url.startsWith('/api/')) return request.ip
      const token = request.cookies.lomme_session
      if (token) {
        const user = await store.userForSession(token)
        if (user) {
          request.currentUser = user
          return user.id
        }
      }
      return request.ip
    },
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'same-origin')
    // The former design-preview lives on another origin. Its migration endpoint
    // still authenticates each request with Telegram's signed initData, so it is
    // safe to allow that one narrow, one-way request across origins.
    const isLegacyPreviewMigration = request.url.startsWith('/api/v1/migrations/design-preview')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.url.startsWith('/api/v1/') && !request.url.startsWith('/api/v1/auth/') && !request.url.startsWith('/api/v1/telegram/') && !isLegacyPreviewMigration) {
      const appUrl = process.env.APP_URL
      if (appUrl) {
        try { ensureSameOrigin(request.headers.origin, appUrl) } catch { throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Источник запроса не разрешён') }
      }
    }
  })

  const requireUser = async (request: FastifyRequest) => {
    if (request.currentUser) return
    const token = request.cookies.lomme_session
    if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Откройте приложение через Telegram')
    const user = await store.userForSession(token)
    if (!user) throw new AppError(401, 'SESSION_EXPIRED', 'Сессия истекла, откройте приложение заново')
    request.currentUser = user
  }

  // Liveness: the process is up. Kept trivial on purpose — a restart is never
  // the right answer to a database that is merely slow.
  app.get('/healthz', async (_request, reply) => {
    const state = await store.health()
    return reply.send({ ok: true, service: 'lomme', ...state, now: new Date().toISOString() })
  })

  // Readiness: this build may serve traffic. Answers 503 while the schema is
  // behind, so a deploy whose migration step failed cannot be reported green.
  app.get('/readyz', async (_request, reply) => {
    const state = await store.readiness()
    return reply.code(state.ready ? 200 : 503).send({ ...state, service: 'lomme', now: new Date().toISOString() })
  })

  // Keep the tap on a normal same-origin HTTPS link so Telegram's iOS WebView
  // accepts it, then hand off through Apple's published Shortcut page.
  app.get('/shortcut/install', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').redirect(shortcutIcloudUrl()))

  app.post('/api/v1/auth/telegram', async (request, reply) => {
    const input = parse(authTelegramSchema, request.body)
    let identity: TelegramIdentity
    let startParam: string | null = null
    if (!input.initData && process.env.ALLOW_DEV_AUTH === 'true') {
      identity = { id: 901_082_024, firstName: 'Алекс', lastName: null, username: 'lomme_demo', languageCode: 'ru' }
    } else {
      try {
        identity = validateTelegramInitData(input.initData, process.env.TELEGRAM_BOT_TOKEN || '', telegramInitMaxAgeSeconds())
        startParam = telegramStartParam(input.initData)
      }
      catch (error) {
        const code = error instanceof Error ? error.message : 'TELEGRAM_AUTH_INVALID'
        throw new AppError(401, code, code === 'TELEGRAM_AUTH_EXPIRED' ? 'Авторизация Telegram устарела' : 'Не удалось проверить авторизацию Telegram')
      }
    }
    const session = await store.createSession(identity, input.timezone)
    reply.setCookie('lomme_session', session.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 })
    return reply.send({ user: session.user, startParam })
  })

  app.delete('/api/v1/session', { preHandler: requireUser }, async (request, reply) => {
    if (request.cookies.lomme_session) await store.revokeSession(request.cookies.lomme_session)
    reply.clearCookie('lomme_session', { path: '/' })
    return reply.code(204).send()
  })

  app.get('/api/v1/me', { preHandler: requireUser }, async (request) => request.currentUser)
  app.get('/api/v1/snapshot', { preHandler: requireUser }, async (request) => {
    const query = request.query as { workspaceId?: string; accountId?: string; period?: string; start?: string; end?: string }
    if (query.workspaceId) parse(uuidSchema, query.workspaceId)
    const accountId = query.accountId === 'all' ? null : query.accountId ? parse(uuidSchema, query.accountId) : undefined
    // `period=YYYY-MM` is the older shape and still resolves to that whole month.
    const legacy = query.period && /^\d{4}-\d{2}$/.test(query.period)
      ? { start: `${query.period}-01T00:00:00.000Z`, end: new Date(Date.UTC(Number(query.period.slice(0, 4)), Number(query.period.slice(5, 7)), 0, 23, 59, 59)).toISOString() }
      : undefined
    return store.snapshot(request.currentUser!.id, query.workspaceId, legacy || { start: query.start, end: query.end }, accountId)
  })

  app.get('/api/v1/transactions', { preHandler: requireUser }, async (request) => {
    const query = parse(transactionPageQuerySchema, request.query)
    return store.transactionsPage(request.currentUser!.id, query.workspaceId, { start: query.start, end: query.end }, query.cursor, query.limit, query.accountId)
  })

  app.post('/api/v1/transactions', { preHandler: requireUser }, async (request, reply) => {
    const input = parse(createTransactionSchema, request.body)
    const idempotencyKey = request.headers['idempotency-key']
    if (!idempotencyKey || Array.isArray(idempotencyKey) || idempotencyKey.length > 120) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Для операции нужен Idempotency-Key')
    return reply.code(201).send(await store.createTransaction(request.currentUser!.id, input, idempotencyKey))
  })
  app.put('/api/v1/transactions/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = parseId(request.params); const input = parse(updateTransactionSchema, request.body)
    await store.updateTransaction(request.currentUser!.id, id, input); return reply.code(204).send()
  })
  app.delete('/api/v1/transactions/:id', { preHandler: requireUser }, async (request, reply) => {
    const { id } = parseId(request.params); const query = request.query as { version?: string }
    const version = Number(query.version); if (!Number.isInteger(version) || version < 1) throw new AppError(400, 'VALIDATION_ERROR', 'Передайте актуальную версию')
    await store.deleteTransaction(request.currentUser!.id, id, version); return reply.code(204).send()
  })

  app.post('/api/v1/accounts', { preHandler: requireUser }, async (request, reply) => reply.code(201).send(await store.createAccount(request.currentUser!.id, parse(createAccountSchema, request.body))))
  app.put('/api/v1/accounts/:id', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); await store.updateAccount(request.currentUser!.id, id, parse(updateAccountSchema, request.body)); return reply.code(204).send() })
  app.delete('/api/v1/accounts/:id', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); const version = Number((request.query as { version?: string }).version); await store.archiveAccount(request.currentUser!.id, id, version); return reply.code(204).send() })
  app.put('/api/v1/me/active-account', { preHandler: requireUser }, async (request, reply) => { await store.setActiveAccount(request.currentUser!.id, parse(activeAccountSchema, request.body)); return reply.code(204).send() })
  app.post('/api/v1/accounts/:id/invites', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const { id } = parseId(request.params)
    parse(accountInviteSchema, request.body || {})
    // Resolve the username from the authenticated Bot API before persisting the
    // invite. A guessed fallback can point at an unrelated Telegram account.
    const botUsername = await inviteBotUsername()
    const invite = await store.createAccountInvite(request.currentUser!.id, id)
    // Keep the start parameter in the actual shared URL. Telegram's prepared
    // message preview can open the generic Main Mini App card and drop the
    // button query on iOS. Fullscreen is explicit so the link cannot inherit a
    // compact BotFather default.
    const url = `https://t.me/${botUsername}?startapp=invite_${invite.token}&mode=fullscreen`
    return reply.code(201).send({ ...invite, url })
  })
  app.post('/api/v1/account-invites/preview', { preHandler: requireUser }, async (request) => { const { token } = parse(inviteTokenSchema, request.body); return store.previewAccountInvite(request.currentUser!.id, token) })
  app.post('/api/v1/account-invites/accept', { preHandler: requireUser }, async (request) => {
    const { token } = parse(inviteTokenSchema, request.body)
    const result = await store.acceptAccountInvite(request.currentUser!.id, token)
    // Telling the inviter is a courtesy, not part of joining: a failure here
    // must not turn a successful acceptance into an error.
    if (result.joined?.inviterTelegramUserId) {
      const outcome = await sendMessage(result.joined.inviterTelegramUserId, accountInviteAccepted(result.joined.memberName, result.joined.accountName))
      if (!outcome.ok) request.log.warn({ event: 'telegram_join_notice_failed', description: outcome.description }, 'Join notice failed')
    }
    return { workspaceId: result.workspaceId, accountId: result.accountId }
  })
  app.delete('/api/v1/accounts/:id/invites/:inviteId', { preHandler: requireUser }, async (request, reply) => { const params = request.params as { id: string; inviteId: string }; parse(uuidSchema, params.id); parse(uuidSchema, params.inviteId); await store.revokeAccountInvite(request.currentUser!.id, params.id, params.inviteId); return reply.code(204).send() })
  app.delete('/api/v1/accounts/:id/members/:memberId', { preHandler: requireUser }, async (request, reply) => { const params = request.params as { id: string; memberId: string }; parse(uuidSchema, params.id); parse(uuidSchema, params.memberId); await store.removeAccountMember(request.currentUser!.id, params.id, params.memberId); return reply.code(204).send() })
  app.post('/api/v1/accounts/:id/leave', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); await store.leaveAccount(request.currentUser!.id, id); return reply.code(204).send() })
  app.post('/api/v1/categories', { preHandler: requireUser }, async (request, reply) => reply.code(201).send(await store.createCategory(request.currentUser!.id, parse(createCategorySchema, request.body))))
  app.put('/api/v1/categories/:id', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); await store.updateCategory(request.currentUser!.id, id, parse(updateCategorySchema, request.body)); return reply.code(204).send() })
  app.put('/api/v1/categories/reorder', { preHandler: requireUser }, async (request, reply) => { await store.reorderCategories(request.currentUser!.id, parse(reorderCategoriesSchema, request.body)); return reply.code(204).send() })
  app.delete('/api/v1/categories/:id', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); const version = Number((request.query as { version?: string }).version); await store.archiveCategory(request.currentUser!.id, id, version); return reply.code(204).send() })
  app.post('/api/v1/workspaces', { preHandler: requireUser }, async (request, reply) => reply.code(201).send(await store.createWorkspace(request.currentUser!.id, parse(createWorkspaceSchema, request.body))))
  app.post('/api/v1/workspaces/:id/invites', { preHandler: requireUser }, async (request, reply) => { const { id } = parseId(request.params); return reply.code(201).send(await store.createInvite(request.currentUser!.id, id)) })
  app.post('/api/v1/invites/accept', { preHandler: requireUser }, async (request) => { const body = request.body as { token?: unknown }; if (typeof body?.token !== 'string') throw new AppError(400, 'VALIDATION_ERROR', 'Не передан токен приглашения'); return store.acceptInvite(request.currentUser!.id, body.token) })
  app.delete('/api/v1/workspaces/:id/members/:memberId', { preHandler: requireUser }, async (request, reply) => { const params = request.params as { id: string; memberId: string }; parse(uuidSchema, params.id); parse(uuidSchema, params.memberId); await store.removeMember(request.currentUser!.id, params.id, params.memberId); return reply.code(204).send() })
  app.post('/api/v1/migrations/design-preview', { config: { rateLimit: { max: 8, timeWindow: '1 hour' } } }, async (request) => {
    const input = parse(legacyPreviewMigrationSchema, request.body)
    let identity: TelegramIdentity
    try { identity = validateTelegramInitData(input.initData, process.env.TELEGRAM_BOT_TOKEN || '', telegramInitMaxAgeSeconds()) }
    catch (error) {
      const code = error instanceof Error ? error.message : 'TELEGRAM_AUTH_INVALID'
      request.log.warn({ event: 'legacy_preview_migration_rejected', code }, 'Legacy preview migration rejected')
      throw new AppError(401, code, 'Не удалось подтвердить Telegram для переноса данных')
    }

    const session = await store.createSession(identity, input.timezone)
    const before = await store.snapshot(session.user.id)
    const workspaceId = before.activeWorkspaceId
    const accountId = before.accounts.find((item) => !item.archivedAt && item.name === 'Кошелёк')?.id
      || before.accounts.find((item) => !item.archivedAt)?.id
    if (!accountId) throw new AppError(409, 'ACCOUNT_NOT_FOUND', 'Не найден счёт для переноса данных')

    const categoryIdByLegacyId = new Map<string, string>()
    const categoryByTypeAndName = new Map(before.categories
      .filter((item) => !item.archivedAt)
      .map((item) => [`${item.type}:${item.name.trim().toLocaleLowerCase('ru')}`, item.id]))
    for (const category of input.categories) {
      const key = `${category.type}:${category.name.trim().toLocaleLowerCase('ru')}`
      let categoryId = categoryByTypeAndName.get(key)
      if (!categoryId) {
        categoryId = (await store.createCategory(session.user.id, {
          workspaceId, type: category.type, name: category.name, icon: category.icon, color: category.color, parentId: null,
        })).id
        categoryByTypeAndName.set(key, categoryId)
      }
      categoryIdByLegacyId.set(category.id, categoryId)
    }

    for (const entry of input.entries) {
      await store.createTransaction(session.user.id, {
        workspaceId,
        type: entry.type,
        amountKopecks: entry.amountKopecks,
        accountId,
        categoryId: entry.categoryId ? categoryIdByLegacyId.get(entry.categoryId) || null : null,
        occurredAt: entry.occurredAt,
        note: entry.note,
        source: 'import',
      }, `legacy-preview:${entry.id}`)
    }
    if (input.openingBalanceKopecks) {
      await store.createTransaction(session.user.id, {
        workspaceId,
        type: input.openingBalanceKopecks > 0 ? 'income' : 'expense',
        amountKopecks: Math.abs(input.openingBalanceKopecks),
        accountId,
        categoryId: null,
        occurredAt: '2000-01-01T00:00:00.000Z',
        note: 'Начальный остаток, перенесённый из превью',
        source: 'import',
      }, 'legacy-preview:opening-balance')
    }
    return { accepted: input.entries.length, target: process.env.APP_URL || null }
  })
  // Issued from inside the Mini App, used from the iOS shortcut. An existing
  // key is only replaced after an explicit confirmation from the setup screen:
  // merely opening the screen must never invalidate an installed command.
  app.get('/api/v1/reminders', { preHandler: requireUser }, async (request) =>
    store.reminderSettings(request.currentUser!.id))

  app.patch('/api/v1/reminders', { preHandler: requireUser }, async (request) =>
    store.saveReminderSettings(request.currentUser!.id, parse(reminderSettingsSchema, request.body)))

  app.post('/api/v1/quick-key', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const userId = request.currentUser!.id
    const replace = (request.body as { replace?: unknown } | null)?.replace === true
    if (await store.hasQuickKey(userId) && !replace) {
      throw new AppError(409, 'QUICK_KEY_EXISTS', 'Личный ключ уже активен')
    }
    return reply.code(201).send(await store.issueQuickKey(userId))
  })
  // This deliberately reveals only whether a key exists. The key itself is
  // returned once by POST and must never be recoverable from the Mini App.
  app.get('/api/v1/quick-key/status', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) =>
    ({ active: await store.hasQuickKey(request.currentUser!.id) }))

  /**
   * The only endpoint a shortcut can reach. It authenticates with the personal key
   * instead of a session, and can do exactly one thing: record an expense.
   */
  const recordQuick = async (key: string, payload: unknown) => {
    if (!key) throw new AppError(401, 'QUICK_KEY_MISSING', 'Нужен ключ')
    return store.createQuickEntry(key, parse(quickEntrySchema, payload))
  }
  const bearerFrom = (header?: string) => header?.startsWith('Bearer ') ? header.slice(7).trim() : ''

  app.post('/api/v1/quick', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) =>
    reply.code(201).send(await recordQuick(bearerFrom(request.headers.authorization), request.body)))

  app.get('/api/v1/quick', { logLevel: 'silent', config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = request.query as { q?: string; amount?: string; text?: string }
    // `q` is the whole thing in one field ("1250 такси") — that keeps the shortcut
    // down to two actions. `amount`/`text` stay for a shortcut with two prompts.
    const parsed = query.q ? parseQuickLine(query.q) : null
    if (parsed?.status === 'rejected') throw new AppError(400, REJECTION_CODES[parsed.reason], 'Не удалось разобрать строку')
    const split = parsed?.status === 'ok' ? parsed : null
    const result = await recordQuick(bearerFrom(request.headers.authorization), {
      amount: split?.amount ?? query.amount ?? '', text: split?.text ?? query.text ?? '',
    })
    // Shortcuts shows this string in its notification, so it has to read as a
    // confirmation to a person, not as JSON.
    const kopecks = parseQuickAmount(split?.amount ?? query.amount ?? '') ?? 0
    const sum = (kopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    return reply.type('text/plain; charset=utf-8').send(
      `✅ Записано ${sum} ₽\n${result.categoryName ?? 'Без категории'}`)
  })

  /**
   * Telegram's own way of proving an update came from Telegram: a header it
   * sends on every delivery, compared in constant time.
   *
   * The old scheme put the same secret in the URL path, where Fastify writes
   * it into the access log of every request — and anyone who can read that log
   * can forge an update carrying somebody else's Telegram user id. The path
   * route stays for now so updates are not lost between this deploy and the
   * setWebhook call that moves the secret into the header; it is removed once
   * the header is confirmed live.
   */
  const webhookSecretMatches = (request: FastifyRequest, pathSecret?: string) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    if (!expected) return false
    const provided = request.headers['x-telegram-bot-api-secret-token']
    const candidate = typeof provided === 'string' ? provided : pathSecret
    if (!candidate || candidate.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
  }

  const handleWebhook = async (request: FastifyRequest, reply: FastifyReply, pathSecret?: string) => {
    if (!webhookSecretMatches(request, pathSecret)) throw new AppError(404, 'NOT_FOUND', 'Не найдено')
    const update = request.body as TelegramUpdate
    request.log.info({ event: 'telegram_update_received', updateId: update.update_id })

    // Telegram redelivers whenever the webhook is slow to answer. A redelivery
    // must never write money twice, but it must still get an answer: if the
    // first attempt recorded an expense and then failed to confirm it, the
    // confirmation is rebuilt from that expense and sent again.
    const updateId = Number.isSafeInteger(update.update_id) ? update.update_id! : null
    if (updateId !== null) {
      const claim = await store.claimTelegramUpdate(updateId)
      if (!claim.fresh) {
        if (claim.delivered) {
          request.log.info({ event: 'telegram_update_duplicate', updateId }, 'Telegram update already handled')
          return reply.send({ ok: true })
        }
        // Seen, undelivered, and no expense came of it — a greeting or a help
        // reply whose send failed. Running it again costs nothing, and the
        // person still gets an answer.
        if (!claim.entry) request.log.info({ event: 'telegram_update_retry', updateId }, 'Retrying an update that recorded no money')
      }
      if (!claim.fresh && claim.entry) {
        request.log.info({ event: 'telegram_update_reconfirm', updateId }, 'Re-sending confirmation for a recorded expense')
        const chatId = update.message?.chat?.id
        if (!Number.isSafeInteger(chatId)) return reply.send({ ok: true })
        const repeat = await sendMessage(chatId!, confirmationFor(claim.entry))
        if (repeat.ok) await store.markTelegramUpdateDelivered(updateId)
        else if (!repeat.permanent) return reply.code(502).send({ ok: false })
        return reply.send({ ok: true })
      }
    }

    // The username is needed for the deep-linked buttons; without it they are
    // dropped rather than aimed at a guess.
    const linkedBotUsername = await inviteBotUsername().catch(() => null)
    const action = await routeUpdate(update, {
      links: { appUrl: telegramWebAppUrl(), botUsername: linkedBotUsername },
      noteBotContact: (telegramUserId) => store.noteBotContact(telegramUserId),
      recordEntry: async (telegramUserId, amount, text) => {
        try {
          const entry = await store.createBotEntry(telegramUserId, parse(quickEntrySchema, { amount, text }), updateId)
          return { status: 'recorded', entry }
        } catch (error) {
          // Someone who has never opened the Mini App has no wallet to record
          // into, and that is worth its own answer rather than a generic failure.
          if (error instanceof AppError && error.code === 'BOT_USER_UNKNOWN') return { status: 'no-account' }
          request.log.error({ event: 'telegram_entry_failed', error: error instanceof Error ? error.message : 'unknown' }, 'Telegram entry failed')
          return { status: 'failed' }
        }
      },
      categoryChoices: (telegramUserId, transactionId) => store.botCategoryChoices(telegramUserId, transactionId),
      correctCategory: (telegramUserId, transactionId, prefix) => store.correctBotEntry(telegramUserId, transactionId, prefix),
      deleteEntry: (telegramUserId, transactionId) => store.deleteBotEntry(telegramUserId, transactionId),
      resolveInvite: async (token) => {
        try {
          const preview = await store.previewAccountInvite('', token)
          if (preview.status !== 'active' && preview.status !== 'accepted') return null
          const botUsername = await inviteBotUsername()
          return { accountName: preview.accountName, url: `https://t.me/${botUsername}?startapp=invite_${token}&mode=fullscreen` }
        } catch {
          // A malformed, revoked or unknown link is answered, not retried.
          return null
        }
      },
    })

    if (action.kind === 'none') return reply.send({ ok: true })
    if (action.kind === 'answer') await answerCallbackQuery(action.callbackQueryId)

    // Replacing the message a button sat on keeps a correction from adding a
    // second bubble to the chat every time. If that message is gone — deleted,
    // or older than Telegram will edit — the answer is still owed, so it goes
    // out as a new one rather than being lost.
    const edited = action.kind === 'answer' && action.replaceMessageId !== undefined
      ? await editMessage(action.chatId, action.replaceMessageId, action.message)
      : null
    const outcome = edited?.ok ? edited : await sendMessage(action.chatId, action.message)
    if (!outcome.ok) {
      request.log.error({ event: 'telegram_reply_failed', updateId, permanent: outcome.permanent, description: outcome.description }, 'Telegram reply failed')
      // The claim is kept either way. Telegram's retry will find the recorded
      // expense and re-send the confirmation instead of writing a second one.
      if (!outcome.permanent) return reply.code(502).send({ ok: false })
    }
    if (updateId !== null && outcome.ok) await store.markTelegramUpdateDelivered(updateId)
    return reply.send({ ok: true })
  }

  app.post('/api/v1/telegram/webhook', async (request, reply) => handleWebhook(request, reply))
  // Deprecated: kept only until the webhook is re-registered with a header.
  app.post('/api/v1/telegram/webhook/:secret', async (request, reply) =>
    handleWebhook(request, reply, (request.params as { secret?: string }).secret))

  app.setErrorHandler((error, request, reply) => {
    const isShortcutGet = request.method === 'GET'
      && (request.url === '/api/v1/quick' || request.url.startsWith('/api/v1/quick?'))
    if (isShortcutGet) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).type('text/plain; charset=utf-8').send(shortcutErrorText(error.code))
      }
      if (error instanceof ZodError) {
        return reply.code(400).type('text/plain; charset=utf-8').send(shortcutErrorText('VALIDATION_ERROR'))
      }
      if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
        return reply.code(429).type('text/plain; charset=utf-8').send(shortcutErrorText('RATE_LIMITED'))
      }
      request.log.error({ err: error, requestId: request.id })
      return reply.code(500).type('text/plain; charset=utf-8').send(shortcutErrorText('INTERNAL_ERROR'))
    }
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors, requestId: request.id } })
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Проверьте заполненные поля', fieldErrors: error.flatten().fieldErrors, requestId: request.id } })
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      return reply.code(429).send(errorBody('RATE_LIMITED', 'Слишком много запросов, попробуйте позже', request.id))
    }
    request.log.error({ err: error, requestId: request.id })
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Что-то пошло не так', request.id))
  })

  const webRoot = path.resolve(process.cwd(), 'dist')
  // Test runs do not build Vite first. Register the public folder there so the
  // same install endpoint still returns the actual Shortcut binary.
  const staticRoot = existsSync(webRoot) ? webRoot : path.resolve(process.cwd(), 'public')
  if (existsSync(staticRoot)) {
    // Railway does not compress the assets that Fastify streams by itself.  On a
    // mobile connection the icon sprite was therefore a 145 KB late request,
    // even though the browser only needs about 28 KB of it when compressed.
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
      setHeaders(response, filePath) {
        const inAssets = filePath.includes(`${path.sep}assets${path.sep}`)
        const inFonts = filePath.includes(`${path.sep}fonts${path.sep}`)
        const isShortcut = filePath.endsWith('.shortcut')
        if (isShortcut) {
          response.header('Content-Type', 'application/octet-stream')
          response.header('Content-Disposition', `attachment; filename="Lomme-shortcut.shortcut"; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`)
          response.header('Access-Control-Allow-Origin', 'https://web.telegram.org')
          response.header('Cache-Control', 'no-store')
          return
        }
        if (inAssets) {
          // Vite fingerprints every file in /assets, so a deployed build can
          // safely stay in cache forever and never delay a second app open.
          response.header('Cache-Control', 'public, max-age=31536000, immutable')
        } else if (inFonts || filePath.endsWith(`${path.sep}icons-library.svg`)) {
          // These URLs are stable instead of fingerprinted.  Keep them warm for
          // repeat opens without trapping a future font or icon-library update.
          response.header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
        } else {
          response.header('Cache-Control', 'no-cache')
        }
      },
    })
    if (staticRoot === webRoot) {
      app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/') || request.url.startsWith('/assets/')) {
          return reply.code(404).send(errorBody('NOT_FOUND', 'Маршрут не найден', request.id))
        }
        return reply.sendFile('index.html')
      })
    }
  }

  app.addHook('onClose', async () => store.close())
  return app
}

function parse<T>(schema: ZodType<T>, value: unknown): T { return schema.parse(value) }
function parseId(params: unknown) { const id = (params as { id?: unknown }).id; return { id: parse(uuidSchema, id) } }
function errorBody(code: string, message: string, requestId: string) { return { error: { code, message, requestId } } }
