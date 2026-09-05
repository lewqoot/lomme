import type { FinanceStore } from './types.js'
import { MemoryFinanceStore } from './memory.js'

let singleton: FinanceStore | undefined

/**
 * The in-memory store exists for local development and tests. Reaching it in
 * production would mean a server that accepts expenses, answers 200, and loses
 * every one of them the moment it restarts — with a green deployment the whole
 * time, because the process starts perfectly well.
 *
 * A missing DATABASE_URL is therefore fatal there rather than a fallback. The
 * check is explicit about which variable is missing, since that is the whole
 * content of the failure.
 */
export async function createStore(): Promise<FinanceStore> {
  if (singleton) return singleton
  const url = process.env.DATABASE_URL?.trim()
  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production: refusing to start on the in-memory store')
  }
  let store: FinanceStore
  if (url) {
    const { PostgresFinanceStore } = await import('./postgres.js')
    store = new PostgresFinanceStore(url)
  } else {
    store = new MemoryFinanceStore()
  }
  singleton = store
  return store
}

/** Tests build several isolated apps in one process. */
export function resetStoreForTest() {
  singleton = undefined
}
