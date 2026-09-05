import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../server/app.js'
import { MemoryFinanceStore } from '../server/store/memory.js'

describe('wallet selection and sharing', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let store: MemoryFinanceStore

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.APP_URL = 'https://lomme.example'
    process.env.TELEGRAM_BOT_TOKEN = ''
    process.env.TELEGRAM_BOT_USERNAME = 'lomme_test_bot'
    store = new MemoryFinanceStore()
    app = await buildApp(store)
  })

  afterEach(async () => { vi.unstubAllGlobals(); await app.close() })

  async function session(id: number, firstName: string) {
    const result = await store.createSession({ id, firstName, lastName: null, username: firstName.toLocaleLowerCase('ru'), languageCode: 'ru' }, 'Europe/Moscow')
    return { ...result, cookie: `lomme_session=${result.token}` }
  }

  it('переключает кошельки и даёт редактору доступ только к выбранному общему кошельку', async () => {
    const owner = await session(1001, 'Алекс')
    const guest = await session(1002, 'Ирина')
    const ownerBefore = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const privateAccountId = ownerBefore.activeAccountId as string

    const created = await app.inject({
      method: 'POST', url: '/api/v1/accounts', headers: { cookie: owner.cookie },
      payload: { workspaceId: ownerBefore.activeWorkspaceId, name: 'Кошелёк новый', kind: 'cash', icon: 'wallet', color: '#13C97A', openingBalanceKopecks: 0 },
    })
    expect(created.statusCode).toBe(201)
    const sharedAccountId = created.json().id as string

    const ownerWithNew = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    expect(ownerWithNew.activeAccountId).toBe(sharedAccountId)
    expect(ownerWithNew.transactions.every((item: { accountId: string }) => item.accountId === sharedAccountId)).toBe(true)

    const sharedAccount = ownerWithNew.accounts.find((item: { id: string }) => item.id === sharedAccountId)
    expect((await app.inject({
      method: 'PUT', url: `/api/v1/accounts/${sharedAccountId}`, headers: { cookie: owner.cookie },
      payload: { name: 'Домашний кошелёк', version: sharedAccount.version },
    })).statusCode).toBe(204)

    const inviteResponse = await app.inject({ method: 'POST', url: `/api/v1/accounts/${sharedAccountId}/invites`, headers: { cookie: owner.cookie }, payload: { role: 'editor' } })
    expect(inviteResponse.statusCode).toBe(201)
    expect(inviteResponse.json().url).toMatch(/^https:\/\/t\.me\/lomme_test_bot\?startapp=invite_.+&mode=fullscreen$/)
    const token = inviteResponse.json().token as string

    const preview = await app.inject({ method: 'POST', url: '/api/v1/account-invites/preview', headers: { cookie: guest.cookie }, payload: { token } })
    expect(preview.json()).toMatchObject({ accountId: sharedAccountId, accountName: 'Домашний кошелёк', inviterName: 'Алекс', status: 'active' })
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/account-invites/accept', headers: { cookie: guest.cookie }, payload: { token } })
    expect(accepted.statusCode).toBe(200)

    const guestShared = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: guest.cookie } })).json()
    expect(guestShared.activeAccountId).toBe(sharedAccountId)
    expect(guestShared.accounts.find((item: { id: string }) => item.id === sharedAccountId)).toMatchObject({ accessRole: 'editor', memberCount: 2 })
    expect(guestShared.accounts.some((item: { id: string }) => item.id === privateAccountId)).toBe(false)
    expect(guestShared.members.map((item: { firstName: string }) => item.firstName).sort()).toEqual(['Алекс', 'Ирина'])

    const editorAccount = guestShared.accounts.find((item: { id: string }) => item.id === sharedAccountId)
    expect((await app.inject({ method: 'PUT', url: `/api/v1/accounts/${sharedAccountId}`, headers: { cookie: guest.cookie }, payload: { name: 'Чужое имя', version: editorAccount.version } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${sharedAccountId}?version=${editorAccount.version}`, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/v1/accounts/${sharedAccountId}/invites`, headers: { cookie: guest.cookie }, payload: { role: 'editor' } })).statusCode).toBe(403)

    const category = guestShared.categories.find((item: { type: string; archivedAt: string | null }) => item.type === 'expense' && !item.archivedAt)
    const operation = await app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: { cookie: guest.cookie, 'idempotency-key': 'shared-operation' },
      payload: { workspaceId: guestShared.activeWorkspaceId, type: 'expense', amountKopecks: 2500, accountId: sharedAccountId, categoryId: category.id, occurredAt: new Date().toISOString(), note: 'Общая покупка', source: 'manual' },
    })
    expect(operation.statusCode).toBe(201)
    const ownerScoped = (await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${ownerBefore.activeWorkspaceId}&accountId=${sharedAccountId}`, headers: { cookie: owner.cookie } })).json()
    expect(ownerScoped.accounts.find((item: { id: string }) => item.id === sharedAccountId)).toMatchObject({ accessRole: 'owner', memberCount: 2 })
    expect(ownerScoped.transactions.find((item: { id: string }) => item.id === operation.json().id)).toMatchObject({ authorName: 'Ирина', note: 'Общая покупка' })

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${sharedAccountId}/members/${owner.user.id}`, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${sharedAccountId}/members/${guest.user.id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${ownerBefore.activeWorkspaceId}&accountId=${sharedAccountId}`, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    const guestFallback = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: guest.cookie } })).json()
    expect(guestFallback.accounts.some((item: { id: string }) => item.id === sharedAccountId)).toBe(false)
  })

  it('сохраняет режим «Все счета» и удаляет не последний личный кошелёк', async () => {
    const owner = await session(2001, 'Алекс')
    const before = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const created = (await app.inject({ method: 'POST', url: '/api/v1/accounts', headers: { cookie: owner.cookie }, payload: { workspaceId: before.activeWorkspaceId, name: 'Временный', kind: 'cash', icon: 'wallet', color: '#13C97A', openingBalanceKopecks: 0 } })).json()

    expect((await app.inject({ method: 'PUT', url: '/api/v1/me/active-account', headers: { cookie: owner.cookie }, payload: { workspaceId: before.activeWorkspaceId, accountId: null } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json().activeAccountId).toBeNull()

    const aggregate = (await app.inject({ method: 'GET', url: `/api/v1/snapshot?workspaceId=${before.activeWorkspaceId}&accountId=all`, headers: { cookie: owner.cookie } })).json()
    const temporary = aggregate.accounts.find((item: { id: string }) => item.id === created.id)
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/accounts/${temporary.id}?version=${temporary.version}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json().accounts.some((item: { id: string }) => item.id === temporary.id)).toBe(false)
  })

  it('берёт имя бота из Telegram getMe, а не из ошибочного fallback', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_BOT_USERNAME = 'wrong_channel_bot'
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'Lommebot' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const owner = await session(3001, 'Алекс')
    const before = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()

    const response = await app.inject({ method: 'POST', url: `/api/v1/accounts/${before.activeAccountId}/invites`, headers: { cookie: owner.cookie }, payload: { role: 'editor' } })

    expect(response.statusCode).toBe(201)
    expect(response.json().url).toMatch(/^https:\/\/t\.me\/Lommebot\?startapp=invite_.+&mode=fullscreen$/)
    expect(fetchMock).toHaveBeenCalledWith('https://api.telegram.org/bottest-token/getMe')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не создаёт ссылку на выдуманного Telegram-получателя', async () => {
    process.env.TELEGRAM_BOT_TOKEN = ''
    delete process.env.TELEGRAM_BOT_USERNAME
    const owner = await session(3002, 'Алекс')
    const before = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()

    const response = await app.inject({ method: 'POST', url: `/api/v1/accounts/${before.activeAccountId}/invites`, headers: { cookie: owner.cookie }, payload: { role: 'editor' } })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('TELEGRAM_INVITES_UNAVAILABLE')
  })

  it('доставляет /start-приглашение через бота и открывает точный кошелёк', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret'
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'Lommebot' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      expect(String(input)).toBe('https://api.telegram.org/bottest-token/sendMessage')
      const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string; reply_markup: { inline_keyboard: Array<Array<{ web_app: { url: string } }>> } }
      expect(body.chat_id).toBe(777)
      expect(body.text).toContain('Тебя зовут в общий кошелёк «Кошелёк»')
      expect(body.reply_markup.inline_keyboard[0]![0]!).toMatchObject({ url: expect.stringMatching(/^https:\/\/t\.me\/Lommebot\?startapp=invite_.+&mode=fullscreen$/) })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const owner = await session(4001, 'Алекс')
    const before = (await app.inject({ method: 'GET', url: '/api/v1/snapshot', headers: { cookie: owner.cookie } })).json()
    const invite = await store.createAccountInvite(owner.user.id, before.activeAccountId)

    const response = await app.inject({
      method: 'POST', url: '/api/v1/telegram/webhook/webhook-secret',
      payload: { update_id: 99, message: { chat: { id: 777, type: 'private' }, text: `/start invite_${invite.token}` } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    delete process.env.TELEGRAM_WEBHOOK_SECRET
  })
})
