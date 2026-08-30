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

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`/api/v1${path}`, { ...options, credentials: 'include', headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorShape | null
    throw new ApiError(body?.error.code || 'REQUEST_FAILED', body?.error.message || 'Не удалось выполнить запрос', response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
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
