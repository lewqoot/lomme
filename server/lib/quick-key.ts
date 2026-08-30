import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Prefix so a leaked string is recognisably ours and can be searched for. */
const PREFIX = 'lom_'

/** A fresh key. Shown once; only its hash is stored. */
export function issueQuickKey() {
  const key = `${PREFIX}${randomBytes(24).toString('base64url')}`
  return { key, hash: hashQuickKey(key) }
}

export const hashQuickKey = (key: string) => createHash('sha256').update(key).digest('hex')

/** Compared in constant time so a wrong key reveals nothing through timing. */
export function quickKeyMatches(key: string, storedHash: string | null | undefined) {
  if (!storedHash) return false
  const candidate = Buffer.from(hashQuickKey(key), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/** Enough of the key to recognise it in the UI without printing the secret. */
export const quickKeyPreview = (key: string) => `${key.slice(0, 8)}…${key.slice(-4)}`
