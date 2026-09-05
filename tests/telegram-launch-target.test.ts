import { afterEach, describe, expect, it, vi } from 'vitest'
import { telegramLaunchTarget } from '../src/lib/telegram.js'
import { initialNavigation, navigationFromLaunch } from '../src/features/navigation/state.js'

afterEach(() => vi.unstubAllGlobals())

function stubWindow(options: { unsafeStartParam?: string; search?: string } = {}) {
  vi.stubGlobal('window', {
    Telegram: { WebApp: { initData: '', initDataUnsafe: { start_param: options.unsafeStartParam } } },
    location: { search: options.search || '', hash: '' },
  })
}

describe('экран, названный ссылкой из бота', () => {
  it('узнаёт каждый разрешённый экран', () => {
    for (const target of ['shortcut', 'notifications', 'family', 'analytics']) {
      stubWindow({ unsafeStartParam: target })
      expect(telegramLaunchTarget()).toBe(target)
    }
  })

  it('читает параметр из адреса, когда Telegram его не отдал', () => {
    stubWindow({ search: '?startapp=notifications' })
    expect(telegramLaunchTarget()).toBe('notifications')
  })

  it('игнорирует незнакомое имя вместо того, чтобы куда-то вести', () => {
    stubWindow({ unsafeStartParam: 'settings-notify' })
    expect(telegramLaunchTarget()).toBeNull()
  })

  it('не принимает приглашение за экран', () => {
    stubWindow({ unsafeStartParam: `invite_${'a'.repeat(32)}` })
    expect(telegramLaunchTarget()).toBeNull()
  })

  it('без параметра остаётся ни с чем', () => {
    stubWindow()
    expect(telegramLaunchTarget()).toBeNull()
  })
})

describe('первый экран запуска', () => {
  it('открывает названный экран, оставляя дорогу назад', () => {
    expect(navigationFromLaunch('settings')).toMatchObject({ page: 'settings', history: ['home'] })
  })

  it('обычный запуск начинается дома и без истории', () => {
    expect(navigationFromLaunch(null)).toBe(initialNavigation)
    expect(navigationFromLaunch('home')).toBe(initialNavigation)
  })
})
