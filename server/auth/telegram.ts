import { createHmac, timingSafeEqual } from 'node:crypto'

export type TelegramIdentity = {
  id: number
  firstName: string
  lastName: string | null
  username: string | null
  languageCode: string | null
  /**
   * Telegram sets this when the person has allowed the bot to message them.
   * It rides inside signed initData, so a Mini App launch tells us whether the
   * bot may write without asking anyone anything. Absent for every launch that
   * predates the grant, which is why it is optional rather than false.
   */
  allowsWriteToPm?: boolean
}

type TelegramUserPayload = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  allows_write_to_pm?: boolean
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 300,
  now = new Date(),
): TelegramIdentity {
  if (!initData || !botToken) throw new Error('TELEGRAM_AUTH_MISSING')

  const params = new URLSearchParams(initData)
  const receivedHash = params.get('hash')
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) throw new Error('TELEGRAM_AUTH_INVALID')
  params.delete('hash')

  // `signature` is Telegram's additional Ed25519 proof for third-party
  // verification. For the bot-token HMAC flow it remains a signed initData
  // field, so only `hash` is removed here. Dropping `signature` makes current
  // Mini App launches fail their otherwise valid HMAC check.

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest()
  const receivedHashBuffer = Buffer.from(receivedHash, 'hex')
  if (receivedHashBuffer.length !== expectedHash.length || !timingSafeEqual(receivedHashBuffer, expectedHash)) {
    throw new Error('TELEGRAM_AUTH_INVALID')
  }

  const authDate = Number(params.get('auth_date'))
  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - authDate)
  if (!Number.isFinite(authDate) || ageSeconds > maxAgeSeconds) throw new Error('TELEGRAM_AUTH_EXPIRED')

  const rawUser = params.get('user')
  if (!rawUser) throw new Error('TELEGRAM_USER_MISSING')
  const user = JSON.parse(rawUser) as TelegramUserPayload
  if (!Number.isSafeInteger(user.id)) throw new Error('TELEGRAM_USER_INVALID')

  return {
    id: user.id,
    firstName: user.first_name || 'Пользователь',
    lastName: user.last_name || null,
    username: user.username || null,
    languageCode: user.language_code || null,
    allowsWriteToPm: user.allows_write_to_pm === true,
  }
}

/** Read only after validateTelegramInitData succeeds: start_param is covered by
 * the same Telegram signature as the user identity. */
export function telegramStartParam(initData: string): string | null {
  const value = new URLSearchParams(initData).get('start_param')
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null
}

export function createTelegramInitDataForTest(identity: TelegramIdentity, botToken: string, now = new Date(), signature?: string, startParam?: string): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(now.getTime() / 1000)),
    query_id: 'test-query',
    user: JSON.stringify({
      id: identity.id,
      first_name: identity.firstName,
      last_name: identity.lastName || undefined,
      username: identity.username || undefined,
      language_code: identity.languageCode || undefined,
      allows_write_to_pm: identity.allowsWriteToPm || undefined,
    }),
  })
  if (signature) params.set('signature', signature)
  if (startParam) params.set('start_param', startParam)
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}
