import { afterEach, describe, expect, it, vi } from 'vitest'
import { openExternalLink } from '../src/lib/telegram.js'

describe('открытие Apple Shortcuts на iPhone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('вызывает Telegram openLink синхронно в поддерживаемом клиенте', () => {
    const openLink = vi.fn()
    vi.stubGlobal('window', { navigator: { userAgent: 'Telegram Desktop' }, Telegram: { WebApp: { platform: 'tdesktop', openLink } } })

    expect(openExternalLink('https://www.icloud.com/shortcuts/example')).toBe(true)
    expect(openLink).toHaveBeenCalledWith('https://www.icloud.com/shortcuts/example')
  })

  it('на iPhone тоже использует нативный мост Telegram', () => {
    const openLink = vi.fn()
    const assign = vi.fn()
    vi.stubGlobal('window', { navigator: { userAgent: 'iPhone' }, location: { assign }, Telegram: { WebApp: { platform: 'ios', openLink } } })

    expect(openExternalLink('https://www.icloud.com/shortcuts/example')).toBe(true)
    expect(openLink).toHaveBeenCalledWith('https://www.icloud.com/shortcuts/example')
    expect(assign).not.toHaveBeenCalled()
  })

  it('переходит обычным способом, если мост Telegram бросил ошибку', () => {
    const assign = vi.fn()
    const openLink = vi.fn(() => { throw new Error('unsupported') })
    vi.stubGlobal('window', { navigator: { userAgent: 'Telegram Desktop' }, location: { assign }, Telegram: { WebApp: { platform: 'tdesktop', openLink } } })

    expect(openExternalLink('https://www.icloud.com/shortcuts/example')).toBe(true)
    expect(assign).toHaveBeenCalledWith('https://www.icloud.com/shortcuts/example')
  })

  it('использует обычную навигацию вне Telegram', () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { navigator: { userAgent: 'Safari' }, location: { assign } })

    expect(openExternalLink('https://www.icloud.com/shortcuts/example')).toBe(true)
    expect(assign).toHaveBeenCalledWith('https://www.icloud.com/shortcuts/example')
  })
})
