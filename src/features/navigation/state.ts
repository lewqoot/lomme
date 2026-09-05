import type { TransactionType, TransactionView } from '../../shared/contracts.js'

export type PageKey = 'home' | 'insights' | 'analytics' | 'accounts' | 'family' | 'settings' | 'categories' | 'search'
export type EditorState = { mode: 'create'; type: TransactionType } | { mode: 'edit'; transaction: TransactionView }
export type NavigationMotion = 'idle' | 'enter-sheet' | 'enter-push' | 'enter-fade' | 'enter-home'
export type NavigationState = { page: PageKey; history: PageKey[]; motion: NavigationMotion; receding: boolean; editor: EditorState | null; editorClosing: boolean; pending: 'idle' | 'page' | 'editor'; revision: number }
export type NavigationAction = { type: 'navigate'; next: PageKey; history: 'push' | 'pop' } | { type: 'open-editor'; editor: EditorState } | { type: 'close-editor' } | { type: 'dismiss-editor' } | { type: 'settle'; pending: 'page' | 'editor'; revision: number }

export const initialNavigation: NavigationState = { page: 'home', history: [], motion: 'idle', receding: false, editor: null, editorClosing: false, pending: 'idle', revision: 0 }

/**
 * A launch that named a screen starts there, with home behind it so Back leads
 * somewhere sensible. Deciding this before the first render keeps it out of an
 * effect, which would otherwise fight a later Back press.
 */
export function navigationFromLaunch(page: PageKey | null): NavigationState {
  if (!page || page === 'home') return initialNavigation
  return { ...initialNavigation, page, history: ['home'] }
}

export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  if (action.type === 'navigate') {
    if (action.next === state.page) return state

    const history = action.history === 'push' ? [...state.history, state.page] : state.history.slice(0, -1)
    const sheet = action.next === 'insights'
    const fromHome = state.page === 'home'
    const restoring = action.next === 'home' && state.page === 'insights'

    return {
      ...state,
      page: action.next,
      history,
      editor: null,
      editorClosing: false,
      receding: restoring || (fromHome && sheet),
      motion: fromHome ? (sheet ? 'enter-sheet' : 'enter-fade') : action.next === 'home' ? (restoring ? 'idle' : 'enter-home') : 'enter-push',
      pending: 'page',
      revision: state.revision + 1,
    }
  }

  if (action.type === 'open-editor') {
    return { ...state, editor: action.editor, editorClosing: false, pending: 'idle', revision: state.revision + 1 }
  }

  if (action.type === 'dismiss-editor') {
    return { ...state, editor: null, editorClosing: false, pending: 'idle', revision: state.revision + 1 }
  }

  if (action.type === 'close-editor') {
    return state.editor && !state.editorClosing
      ? { ...state, editorClosing: true, pending: 'editor', revision: state.revision + 1 }
      : state
  }

  if (action.revision !== state.revision || action.pending !== state.pending) return state

  return action.pending === 'page' ? { ...state, motion: 'idle', receding: false, pending: 'idle' } : { ...state, editor: null, editorClosing: false, pending: 'idle' }
}
