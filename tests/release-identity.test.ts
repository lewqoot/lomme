import { afterEach, describe, expect, it } from 'vitest'
import { bundledSchema, releaseIdentity } from '../server/lib/release.js'

const original = {
  RELEASE_SHA: process.env.RELEASE_SHA,
  RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
  GITHUB_SHA: process.env.GITHUB_SHA,
  RELEASE_VERSION: process.env.RELEASE_VERSION,
}

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('release identity', () => {
  it('exposes the same immutable build identity for each runtime role', () => {
    process.env.RELEASE_SHA = '0123456789abcdef'
    process.env.RELEASE_VERSION = '1.2.3'
    const schema = bundledSchema()

    expect(releaseIdentity('api')).toMatchObject({
      role: 'api',
      sha: '0123456789abcdef',
      appVersion: '1.2.3',
      schemaVersion: schema.version,
      schemaMigrations: schema.migrations,
    })
    expect(releaseIdentity('worker')).toMatchObject({
      role: 'worker',
      sha: '0123456789abcdef',
    })
    expect(schema.migrations).toBeGreaterThan(0)
  })

  it('uses Railway then GitHub commit metadata when RELEASE_SHA is absent', () => {
    delete process.env.RELEASE_SHA
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway-sha'
    process.env.GITHUB_SHA = 'github-sha'
    expect(releaseIdentity('api').sha).toBe('railway-sha')

    delete process.env.RAILWAY_GIT_COMMIT_SHA
    expect(releaseIdentity('api').sha).toBe('github-sha')
  })
})
