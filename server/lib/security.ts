import { createHash, randomBytes } from 'node:crypto'

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    )
  }
  return value
}

/** Stable fingerprint for comparing retries without retaining request data. */
export const hashPayload = (value: unknown) => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')

export function ensureSameOrigin(origin: string | undefined, appUrl: string) {
  if (!origin) return
  const allowed = new URL(appUrl).origin
  if (origin !== allowed) throw new Error('ORIGIN_NOT_ALLOWED')
}
