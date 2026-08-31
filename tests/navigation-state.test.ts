import { describe, expect, it } from 'vitest'
import { initialNavigation, navigationReducer } from '../src/features/navigation/state.js'

describe('navigation state', () => {
  it('lets a new destination replace an unfinished transition', () => {
    const insights = navigationReducer(initialNavigation, { type: 'navigate', next: 'insights', history: 'push' })
    const search = navigationReducer(insights, { type: 'navigate', next: 'search', history: 'push' })

    expect(search).toMatchObject({
      page: 'search',
      history: ['home', 'insights'],
      motion: 'enter-push',
      receding: false,
      pending: 'page',
    })

    expect(navigationReducer(search, { type: 'settle', pending: 'page', revision: insights.revision })).toBe(search)
    expect(navigationReducer(search, { type: 'settle', pending: 'page', revision: search.revision })).toMatchObject({
      motion: 'idle',
      receding: false,
      pending: 'idle',
    })
  })

  it('keeps editor dismissal and navigation in the same state machine', () => {
    const editor = navigationReducer(initialNavigation, { type: 'open-editor', editor: { mode: 'create', type: 'expense' } })
    const closing = navigationReducer(editor, { type: 'close-editor' })
    const settings = navigationReducer(closing, { type: 'navigate', next: 'settings', history: 'push' })

    expect(closing).toMatchObject({ editorClosing: true, pending: 'editor' })
    expect(settings).toMatchObject({ page: 'settings', editor: null, editorClosing: false, pending: 'page' })
    expect(navigationReducer(settings, { type: 'settle', pending: 'editor', revision: closing.revision })).toBe(settings)
  })

  it('returns through history without a second source of truth', () => {
    const settings = navigationReducer(initialNavigation, { type: 'navigate', next: 'settings', history: 'push' })
    const home = navigationReducer(settings, { type: 'navigate', next: 'home', history: 'pop' })

    expect(home).toMatchObject({ page: 'home', history: [], pending: 'page' })
  })
})
