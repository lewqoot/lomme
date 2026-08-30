import type { FinanceStore } from './types.js'
import { MemoryFinanceStore } from './memory.js'

let singleton: FinanceStore | undefined

export async function createStore(): Promise<FinanceStore> {
  if (singleton) return singleton
  let store: FinanceStore
  if (process.env.DATABASE_URL) {
    const { PostgresFinanceStore } = await import('./postgres.js')
    store = new PostgresFinanceStore(process.env.DATABASE_URL)
  } else {
    store = new MemoryFinanceStore()
  }
  singleton = store
  return store
}
