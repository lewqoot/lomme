import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../src/lib/telegram.js'

describe('буфер обмена на iPhone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('использует нативный мост Telegram, когда он доступен', async () => {
    const writeTextToClipboard = vi.fn((_text: string, done: (success: boolean) => void) => done(true))
    vi.stubGlobal('window', { Telegram: { WebApp: { writeTextToClipboard } } })

    await expect(copyText('personal-key')).resolves.toBe(true)
    expect(writeTextToClipboard).toHaveBeenCalledWith('personal-key', expect.any(Function))
  })

  it('возвращается к браузерному API вне Telegram', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('personal-key')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('personal-key')
  })

  it('честно сообщает отказ, если оба способа копирования недоступны', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', {})

    await expect(copyText('summary')).resolves.toBe(false)
  })
})
