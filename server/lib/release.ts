import { readFileSync } from 'node:fs'
import path from 'node:path'

export type ReleaseRole = 'api' | 'worker'

type MigrationJournal = {
  entries?: Array<{ tag?: string }>
}

let cachedSchema: { version: string; migrations: number } | undefined

export function bundledSchema() {
  if (cachedSchema) return cachedSchema
  try {
    const journalPath = path.join(process.cwd(), 'drizzle', 'meta', '_journal.json')
    const entries = (JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal).entries ?? []
    cachedSchema = {
      version: entries.at(-1)?.tag ?? 'unknown',
      migrations: entries.length,
    }
  } catch {
    cachedSchema = { version: 'unknown', migrations: 0 }
  }
  return cachedSchema
}

export function releaseIdentity(role: ReleaseRole) {
  const schema = bundledSchema()
  return {
    role,
    sha: process.env.RELEASE_SHA?.trim()
      || process.env.RAILWAY_GIT_COMMIT_SHA?.trim()
      || process.env.GITHUB_SHA?.trim()
      || 'dev',
    appVersion: process.env.RELEASE_VERSION?.trim() || '0.0.0',
    schemaVersion: schema.version,
    schemaMigrations: schema.migrations,
  }
}
