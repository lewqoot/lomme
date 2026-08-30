import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { initTelegram } from './lib/telegram'

initTelegram()

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } })

class AppCrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lomme render failed', error, info.componentStack)
  }
  render() {
    if (this.state.crashed) return <main className="app-shell state-screen"><h1>Не удалось открыть экран</h1><p>Перезапустите Mini App — данные и приглашение сохранятся.</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Открыть заново</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppCrashBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></AppCrashBoundary>
  </StrictMode>,
)
