import { describe, expect, it } from 'vitest'
import { createTelegramInitDataForTest, telegramStartParam, validateTelegramInitData } from '../server/auth/telegram.js'

const token = '123456:TEST_TOKEN_FOR_SIGNATURE'
const identity = { id: 42, firstName: 'Алекс', lastName: null, username: 'alex', languageCode: 'ru' }
/** Telegram omits the flag entirely when the grant was never given. */
const withoutWriteAccess = { ...identity, allowsWriteToPm: false }

describe('Telegram initData', () => {
  it('принимает корректно подписанные свежие данные', () => {
    const now = new Date('2026-08-24T12:00:00Z')
    expect(validateTelegramInitData(createTelegramInitDataForTest(identity, token, now), token, 300, now)).toEqual(withoutWriteAccess)
  })

  it('принимает текущий формат Mini App с дополнительной подписью Telegram', () => {
    const now = new Date('2026-08-24T12:00:00Z')
    const initData = createTelegramInitDataForTest(identity, token, now, 'third-party-signature')
    expect(validateTelegramInitData(initData, token, 300, now)).toEqual(withoutWriteAccess)
  })

  it('извлекает подписанный start_param приглашения', () => {
    const now = new Date('2026-08-24T12:00:00Z')
    const startParam = `invite_${'a'.repeat(32)}`
    const initData = createTelegramInitDataForTest(identity, token, now, undefined, startParam)
    expect(validateTelegramInitData(initData, token, 300, now)).toEqual(withoutWriteAccess)
    expect(telegramStartParam(initData)).toBe(startParam)
  })

  it('читает разрешение боту писать из подписанных данных', () => {
    const now = new Date('2026-08-24T12:00:00Z')
    const granted = { ...identity, allowsWriteToPm: true }
    const initData = createTelegramInitDataForTest(granted, token, now)
    expect(validateTelegramInitData(initData, token, 300, now).allowsWriteToPm).toBe(true)
  })

  it('отклоняет подделку', () => {
    const initData = createTelegramInitDataForTest(identity, token).replace('alex', 'mallory')
    expect(() => validateTelegramInitData(initData, token)).toThrow('TELEGRAM_AUTH_INVALID')
  })

  it('отклоняет данные старше пяти минут', () => {
    const issued = new Date('2026-08-24T12:00:00Z')
    const checked = new Date('2026-08-24T12:06:00Z')
    expect(() => validateTelegramInitData(createTelegramInitDataForTest(identity, token, issued), token, 300, checked)).toThrow('TELEGRAM_AUTH_EXPIRED')
  })
})
