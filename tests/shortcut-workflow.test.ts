import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const generatorSource = readFileSync(new URL('../scripts/build-lomme-shortcut.py', import.meta.url), 'utf8')

describe('сценарий быстрого ввода для iPhone', () => {
  it('задаёт короткий вопрос и показывает ответ уведомлением без кнопки отмены', () => {
    expect(generatorSource).toContain('💸 Запиши, сколько потратил и на что')
    expect(generatorSource).toContain('is.workflow.actions.notification')
    expect(generatorSource).toContain('WFNotificationActionBody')
    expect(generatorSource).toContain('"WFNotificationActionSound": False')
    expect(generatorSource).not.toContain('is.workflow.actions.showresult')
  })

  it('называется Lomme и содержит фирменные иконку и лаймовую плашку', () => {
    expect(generatorSource).toContain('SHORTCUT_NAME = "Lomme"')
    expect(generatorSource).toContain('"WFWorkflowName": SHORTCUT_NAME')
    expect(generatorSource).toContain('SHORTCUT_ICON_COLOR = -2_873_601')
    expect(generatorSource).toContain('"WFWorkflowIconImageData": logo_data')
  })
})
