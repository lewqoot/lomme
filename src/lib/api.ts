import type { ApiErrorShape } from '../shared/contracts.js'

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; colorScheme: 'light' | 'dark'; ready(): void; expand(): void; close(): void; HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void } } }
  }
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status }
}

export type AuthResult = { user: unknown; startParam: string | null }

export const API_TIMEOUT_MS = 15_000

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort() }, API_TIMEOUT_MS)
  try {
    const response = await fetch(`/api/v1${path}`, { ...options, credentials: 'include', headers, signal: controller.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiErrorShape | null
      throw new ApiError(body?.error.code || 'REQUEST_FAILED', body?.error.message || 'Не удалось выполнить запрос', response.status)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  } catch (error) {
    if (timedOut) throw new ApiError('REQUEST_TIMEOUT', 'Сервер не ответил вовремя. Попробуйте ещё раз', 408)
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function authenticate() {
  const webApp = window.Telegram?.WebApp
  // Telegram viewport ownership belongs to initTelegram(). Calling expand() again
  // when React starts its auth query makes iOS recalculate the client chrome after
  // Home has rendered, which can pull the header underneath its native controls.
  // Authentication only needs the signed launch payload.
  return api<AuthResult>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData: webApp?.initData || '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow' }) })
}

export const haptic = (type: 'light' | 'medium' | 'success' = 'light') => {
  const feedback = window.Telegram?.WebApp?.HapticFeedback
  if (type === 'success') feedback?.notificationOccurred('success')
  else feedback?.impactOccurred(type)
}
