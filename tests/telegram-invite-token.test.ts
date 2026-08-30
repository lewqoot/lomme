import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTelegramInviteToken, telegramInviteToken } from '../src/lib/telegram.js'

const token = 'token_123456789012345678901234'
const startParam = `invite_${token}`

afterEach(() => vi.unstubAllGlobals())

function stubWindow(options: { initData?: string; unsafeStartParam?: string; search?: string; hash?: string } = {}) {
  vi.stubGlobal('window', {
    Telegram: { WebApp: { initData: options.initData || '', initDataUnsafe: { start_param: options.unsafeStartParam } } },
    location: { search: options.search || '', hash: options.hash || '' },
  })
}

describe('Telegram wallet invite launch parameter', () => {
  it('использует start_param, подтверждённый сервером', () => {
    stubWindow({ unsafeStartParam: `invite_${'x'.repeat(32)}` })
    expect(telegramInviteToken(startParam)).toBe(token)
  })

  it('читает start_param из подписанного initData', () => {
    stubWindow({ initData: new URLSearchParams({ start_param: startParam }).toString() })
    expect(telegramInviteToken()).toBe(token)
  })

  it('читает официальный tgWebAppStartParam из query и hash', () => {
    stubWindow({ search: `?tgWebAppStartParam=${startParam}` })
    expect(telegramInviteToken()).toBe(token)
    stubWindow({ hash: `#tgWebAppStartParam=${startParam}` })
    expect(telegramInviteToken()).toBe(token)
  })

  it('удерживает токен, если iOS заменил URL во время авторизации', () => {
    stubWindow({ search: `?tgWebAppStartParam=${startParam}` })
    const remembered = resolveTelegramInviteToken(null)
    stubWindow()
    expect(resolveTelegramInviteToken(remembered)).toBe(token)
  })

  it('читает start_param из вложенного tgWebAppData', () => {
    const signedData = new URLSearchParams({ start_param: startParam, hash: 'telegram-signature' }).toString()
    stubWindow({ search: `?tgWebAppData=${encodeURIComponent(signedData)}` })
    expect(telegramInviteToken()).toBe(token)
  })

  it('игнорирует посторонние и некорректные параметры', () => {
    stubWindow({ search: '?tgWebAppStartParam=other_value' })
    expect(telegramInviteToken()).toBeNull()
    expect(telegramInviteToken('invite_short')).toBeNull()
  })
})
