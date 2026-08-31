import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const telegram = readFileSync(new URL('../src/lib/telegram.ts', import.meta.url), 'utf8')
const contracts = readFileSync(new URL('../src/shared/contracts.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../drizzle/0009_remove_theme_preference.sql', import.meta.url), 'utf8')

describe('light visual system', () => {
  it('uses one screen gutter and one grouped-list language', () => {
    expect(css).toContain('--screen-gutter: 11px')
    expect(css).toContain('--gutter: var(--screen-gutter)')
    expect(css).toMatch(/\.category-manage-list\s*\{[^}]*overflow:\s*clip[^}]*border-radius:\s*18px[^}]*background:\s*var\(--panel\)/s)
    expect(css).toMatch(/\.category-manage-row\s*\{[^}]*padding:\s*5px 12px[^}]*border-bottom:\s*1px solid var\(--line\)[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\.settings-group > \.settings-row\s*\{[^}]*padding:\s*0 12px/s)
  })

  it('removes user-selectable dark appearance and keeps Telegram chrome light', () => {
    expect(css).not.toMatch(/data-theme|prefers-color-scheme|logo-night/)
    expect(contracts).not.toContain('themeSchema')
    expect(telegram).toMatch(/setHeaderColor\?\.\('#ffffff'\)/)
    expect(telegram).toMatch(/setBackgroundColor\?\.\('#ffffff'\)/)
    expect(migration).toContain('DROP COLUMN IF EXISTS "theme"')
  })
})
