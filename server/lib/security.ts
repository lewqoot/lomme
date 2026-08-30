import { createHash, randomBytes } from 'node:crypto'

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function ensureSameOrigin(origin: string | undefined, appUrl: string) {
  if (!origin) return
  const allowed = new URL(appUrl).origin
  if (origin !== allowed) throw new Error('ORIGIN_NOT_ALLOWED')
}
