import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const settingsSource = readFileSync(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('../server/app.ts', import.meta.url), 'utf8')

describe('нативная установка быстрой команды', () => {
  it('открывает опубликованную команду напрямую и не отправляет файл в Telegram-чат', () => {
    expect(settingsSource).toContain('href="/shortcut/install"')
    expect(settingsSource).not.toContain('shortcuts://import-shortcut/')
    expect(settingsSource).toContain('Открыть в «Командах»')
    expect(settingsSource).not.toContain('/shortcut-delivery')
    expect(settingsSource).not.toContain('Отправить команду в чат')
    expect(serverSource).not.toContain("app.post('/api/v1/shortcut-delivery'")
  })
})
