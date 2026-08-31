import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BriefcaseBusiness, CalendarDays,
  Check, ChevronLeft, CircleSlash2, Trash2,
  HandCoins, LoaderCircle, Pencil, PieChart as PieChartIcon, Plus, ReceiptText,
  Flame, RectangleHorizontal, Search, Settings, ShoppingBag, Umbrella, UserMinus, UserPlus, Users, WalletCards
} from 'lucide-react'
import { differenceInCalendarDays, differenceInCalendarMonths, format, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { AccountInvitePreview, AccountView, AppSnapshot, TransactionPage, TransactionType, TransactionView } from './shared/contracts'
import { api, ApiError, authenticate, haptic } from './lib/api'
import { copyText, ensureTelegramFullscreen, haptics, resolveTelegramInviteToken, setBackButton, shareTelegramLink, telegramInviteToken } from './lib/telegram'
import { FALLBACK_ICON, ICON_IDS } from './config/icons'
import { ensureIconLibrary, isCoreIcon, isIconLibraryReady } from './lib/icon-library'
import { tint } from './lib/palette'
import { PeriodPill } from './features/period/PeriodPill'
import { useSwipeToDelete } from './features/motion/useSwipeToDelete'
import { AnalyticsPage } from './features/analytics/AnalyticsPage'
import { fromKopecks, initialCalc, pressKey, resolveKopecks, type CalcKey } from './features/editor/calculator'
import { formatOperationDateLabel, fromLocalDateTimeInput, toLocalDateTimeInput } from './features/editor/datetime'
import { hasReliableInsightSample, savedIncomePercent } from './features/insights/reliability'
import { CategoriesPage } from './features/categories/CategoriesPage'
import { byUsage } from './features/categories/ordering'
import { SettingsPage } from './features/settings/SettingsPage'
import { SearchPage } from './features/search/SearchPage'
import { useElasticOverscroll } from './features/motion/useElasticOverscroll'
import { defaultPeriod, periodKey, resolvePeriod, trendGranularity, type PeriodSelection } from './features/period/model'
import { SNAPSHOT_POLL_INTERVAL_MS, subscribeToForeground } from './lib/foreground-sync'
import { DATA_COLORS, UI_COLORS } from './shared/design-tokens'

// Recharts is by far the heaviest dependency and the home screen never plots
// anything, so it is pulled in only for a deliberate Insights or Analytics action.
// In particular, a tap on Search must not quietly start a chart download in the
// background and compete with the transition on a cellular connection.
const loadInsightsChart = () => import('./charts/InsightsChart')
const loadAnalyticsChart = () => import('./charts/AnalyticsChart')
const warmInsightsChart = () => { void loadInsightsChart() }
const warmAnalyticsChart = () => { void loadAnalyticsChart() }
const InsightsChart = lazy(loadInsightsChart)

type PageKey = 'home' | 'insights' | 'analytics' | 'accounts' | 'family' | 'settings' | 'categories' | 'search'
type EditorState = { mode: 'create'; type: TransactionType } | { mode: 'edit'; transaction: TransactionView }
type ActionProps = { data: AppSnapshot; onRefresh(): void; notify(text: string): void }
type NavigationMotion = 'idle' | 'enter-sheet' | 'enter-push' | 'enter-fade' | 'exit-sheet' | 'exit-push' | 'exit-fade'

const normalizeMinus = (value: string) => value.replace(/^-/, '−')
const money = (kopecks: number, sign = false) => `${sign && kopecks > 0 ? '+' : ''}${normalizeMinus(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(kopecks / 100))} ₽`
const moneyExact = (kopecks: number) => `${normalizeMinus(new Intl.NumberFormat('ru-RU', { minimumFractionDigits: kopecks % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(kopecks / 100))} ₽`
const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
const todayInput = () => toLocalDateTimeInput(new Date())
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const queryClient = useQueryClient()
  useElasticOverscroll()
  const [page, setPage] = useState<PageKey>('home')
  const [workspaceId, setWorkspaceId] = useState<string>()
  const [accountId, setAccountId] = useState<string | null | undefined>()
  const [inviteHandled, setInviteHandled] = useState(false)
  const [period, setPeriod] = useState<PeriodSelection>(() => defaultPeriod())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null)
  const deleteTimers = useRef(new Map<string, number>())
  const [pendingDeleteCount, setPendingDeleteCount] = useState(0)
  const [expandedJournalKey, setExpandedJournalKey] = useState<string | null>(null)
  const [receding, setReceding] = useState(false)
  const [navigationMotion, setNavigationMotion] = useState<NavigationMotion>('idle')
  const [editorClosing, setEditorClosing] = useState(false)
  const navigationTimer = useRef<number | null>(null)
  const editorTimer = useRef<number | null>(null)
  const settingsBackRef = useRef<(() => void) | null>(null)
  const pageHistory = useRef<PageKey[]>([])
  const [capturedInviteToken] = useState<string | null>(() => telegramInviteToken())

  const auth = useQuery({ queryKey: ['auth'], queryFn: authenticate, staleTime: Infinity, retry: false })
  useEffect(() => {
    if (auth.isSuccess) ensureTelegramFullscreen()
  }, [auth.isSuccess])
  // Capture the URL parameter on the very first render and retain it while auth
  // is in flight. A reused Telegram iOS WebView can replace location.search
  // before the auth response returns; signed start_param remains a second source.
  const resolvedInviteToken = resolveTelegramInviteToken(capturedInviteToken, auth.data?.startParam)
  const launchInviteToken = inviteHandled ? null : resolvedInviteToken
  const range = resolvePeriod(period)
  const rangeKey = periodKey(range)
  const accountKey = accountId === undefined ? 'persisted' : accountId || 'all'
  const snapshotKey = ['snapshot', workspaceId, accountKey, rangeKey] as const
  const journalKey = `${workspaceId ?? ''}:${accountKey}:${rangeKey}`
  const journalExpanded = expandedJournalKey === journalKey
  const snapshot = useQuery<AppSnapshot>({
    queryKey: snapshotKey,
    enabled: auth.isSuccess && !launchInviteToken,
    // Keeping the previous window on screen is what stops the layout collapsing to
    // an empty skeleton every time an arrow is tapped.
    placeholderData: (previous) => previous,
    queryFn: () => {
      const query = new URLSearchParams({ start: range.start.toISOString(), end: range.end.toISOString() })
      if (workspaceId) query.set('workspaceId', workspaceId)
      if (accountId === null) query.set('accountId', 'all')
      else if (accountId) query.set('accountId', accountId)
      return api(`/snapshot?${query}`)
    },
    // A Shortcut may write from the Home Screen while this WebView stays open on
    // another device. Keep visible clients close to real time without polling in
    // the background. Returning from the native Shortcuts app is handled below
    // and refreshes immediately.
    refetchInterval: pendingDeleteCount || journalExpanded ? false : SNAPSHOT_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  })
  const data = snapshot.data

  const loadMore = useMutation<TransactionPage, Error, { cursor: string; activeWorkspaceId: string; activeAccountId: string | null; queryKey: readonly unknown[] }>({
    mutationFn: ({ cursor, activeWorkspaceId, activeAccountId }) => {
      const query = new URLSearchParams({
        workspaceId: activeWorkspaceId,
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        cursor,
        limit: String(OPERATIONS_PAGE_SIZE),
      })
      if (activeAccountId) query.set('accountId', activeAccountId)
      return api<TransactionPage>(`/transactions?${query}`)
    },
    onSuccess: (page, variables) => {
      queryClient.setQueryData<AppSnapshot>(variables.queryKey, (current) => {
        if (!current) return current
        const known = new Set(current.transactions.map((item) => item.id))
        return {
          ...current,
          transactions: [...current.transactions, ...page.items.filter((item) => !known.has(item.id))],
          transactionsNextCursor: page.nextCursor,
        }
      })
    },
    onError: () => setToast({ text: 'Не удалось загрузить операции' }),
  })

  const refresh = useCallback(() => { void queryClient.invalidateQueries({ queryKey: ['snapshot'] }) }, [queryClient])
  const selectAccount = useCallback(async (nextWorkspaceId: string, nextAccountId: string | null) => {
    await api('/me/active-account', { method: 'PUT', body: JSON.stringify({ workspaceId: nextWorkspaceId, accountId: nextAccountId }) })
    setWorkspaceId(nextWorkspaceId)
    setAccountId(nextAccountId)
    setExpandedJournalKey(null)
    await queryClient.invalidateQueries({ queryKey: ['snapshot'] })
  }, [queryClient])
  const resetAccountScope = useCallback(() => {
    setWorkspaceId(undefined)
    setAccountId(undefined)
    setExpandedJournalKey(null)
    void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
  }, [queryClient])
  useEffect(() => subscribeToForeground(refresh), [refresh])
  useEffect(() => () => {
    if (navigationTimer.current) window.clearTimeout(navigationTimer.current)
    if (editorTimer.current) window.clearTimeout(editorTimer.current)
    for (const timer of deleteTimers.current.values()) window.clearTimeout(timer)
    deleteTimers.current.clear()
  }, [])

  const navigate = useCallback((next: PageKey, history: 'push' | 'pop' = 'push') => {
    if (next === page || navigationMotion.startsWith('exit')) return
    haptic()
    if (navigationTimer.current) window.clearTimeout(navigationTimer.current)
    if (history === 'push') pageHistory.current.push(page)
    else pageHistory.current.pop()

    // Only Insights rises as a sheet with Home receding beneath it - that gesture is
    // the one the reference builds a handover for. Every other module simply takes
    // over the screen; giving them all the sheet meant mounting a second copy of
    // Home under each one, which showed through as two screens overlapping.
    const sheetPage = (target: PageKey) => target === 'insights'

    if (page === 'home') {
      const asSheet = sheetPage(next)
      setNavigationMotion(asSheet ? 'enter-sheet' : 'enter-fade')
      if (asSheet) setReceding(true)
      setPage(next)
      navigationTimer.current = window.setTimeout(() => {
        setReceding(false)
        setNavigationMotion('idle')
        navigationTimer.current = null
      }, prefersReducedMotion() ? 120 : asSheet ? 440 : 240)
      return
    }

    const toHome = next === 'home'
    const leavingSheet = sheetPage(page)
    setNavigationMotion(toHome ? (leavingSheet ? 'exit-sheet' : 'exit-fade') : 'exit-push')
    if (toHome && leavingSheet) setReceding(true)
    navigationTimer.current = window.setTimeout(() => {
      setPage(next)
      setEditor(null)
      setReceding(false)
      setNavigationMotion(toHome ? 'idle' : 'enter-push')
      // This runs in the same task that mounts the next screen. A smooth reset
      // made Home visibly travel upward after Search (and every other overlay)
      // had already gone away.
      window.scrollTo({ top: 0, behavior: 'auto' })
      navigationTimer.current = window.setTimeout(() => {
        setNavigationMotion('idle')
        navigationTimer.current = null
      }, prefersReducedMotion() ? 120 : 400)
    }, prefersReducedMotion() ? 120 : leavingSheet && toHome ? 360 : 200)
  }, [navigationMotion, page])
  const goBack = useCallback(() => {
    const previous = pageHistory.current.at(-1) || 'home'
    navigate(previous, 'pop')
  }, [navigate])
  const openInsights = () => { warmInsightsChart(); navigate('insights') }
  const closeEditor = useCallback(() => {
    if (editorClosing) return
    setEditorClosing(true)
    editorTimer.current = window.setTimeout(() => {
      setEditor(null)
      setEditorClosing(false)
      editorTimer.current = null
    }, prefersReducedMotion() ? 120 : 360)
  }, [editorClosing])
  // Back is always an explicit in-app control. Relying on Telegram's native
  // BackButton left iOS clients without any visible way to return, while showing
  // both controls duplicated it on clients that did support the bridge.
  useEffect(() => setBackButton(false, () => {}), [])

  const activeWorkspace = data?.workspaces.find((item) => item.id === data.activeWorkspaceId)
  const totalBalance = (data?.accounts || []).filter((item) => !item.archivedAt && item.workspaceId === data?.activeWorkspaceId && (!data?.activeAccountId || item.id === data.activeAccountId)).reduce((sum, item) => sum + item.balanceKopecks, 0)
  const requestMoreTransactions = () => {
    if (!data?.transactionsNextCursor || loadMore.isPending) return
    haptic()
    setExpandedJournalKey(journalKey)
    loadMore.mutate({ cursor: data.transactionsNextCursor, activeWorkspaceId: data.activeWorkspaceId, activeAccountId: data.activeAccountId, queryKey: snapshotKey })
  }

  const scheduleDelete = (transaction: TransactionView) => {
    if (deleteTimers.current.has(transaction.id)) return
    setEditor(null)
    void queryClient.cancelQueries({ queryKey: ['snapshot'] })
    queryClient.setQueryData<AppSnapshot>(snapshotKey, (current) => {
      if (!current) return current
      const transactions = current.transactions.filter((item) => item.id !== transaction.id)
      return {
        ...current,
        transactions,
        accounts: current.accounts.map((account) => {
          if (account.id === transaction.accountId) return { ...account, balanceKopecks: account.balanceKopecks + (transaction.type === 'income' ? -transaction.amountKopecks : transaction.amountKopecks) }
          if (account.id === transaction.targetAccountId) return { ...account, balanceKopecks: account.balanceKopecks - transaction.amountKopecks }
          return account
        }),
      }
    })
    const restore = () => queryClient.setQueryData<AppSnapshot>(snapshotKey, (current) => {
      if (!current || current.transactions.some((item) => item.id === transaction.id)) return current
      const transactions = [...current.transactions, transaction].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      return {
        ...current,
        transactions,
        accounts: current.accounts.map((account) => {
          if (account.id === transaction.accountId) return { ...account, balanceKopecks: account.balanceKopecks + (transaction.type === 'income' ? transaction.amountKopecks : -transaction.amountKopecks) }
          if (account.id === transaction.targetAccountId) return { ...account, balanceKopecks: account.balanceKopecks + transaction.amountKopecks }
          return account
        }),
      }
    })
    const undo = () => {
      const timer = deleteTimers.current.get(transaction.id)
      if (timer === undefined) return
      window.clearTimeout(timer)
      deleteTimers.current.delete(transaction.id)
      setPendingDeleteCount(deleteTimers.current.size)
      setToast(null)
      restore()
    }
    setToast({ text: 'Операция удалена', action: 'Отменить', onAction: undo })
    const timer = window.setTimeout(async () => {
      deleteTimers.current.delete(transaction.id)
      setPendingDeleteCount(deleteTimers.current.size)
      try {
        await api(`/transactions/${transaction.id}?version=${transaction.version}`, { method: 'DELETE' })
        if (!deleteTimers.current.size) refresh()
      } catch {
        restore()
        setToast({ text: 'Не удалось удалить операцию' })
        if (!deleteTimers.current.size) refresh()
      }
    }, 4300)
    deleteTimers.current.set(transaction.id, timer)
    setPendingDeleteCount(deleteTimers.current.size)
  }

  if (auth.isPending) return <Loading />
  if (auth.isError) return <AuthError error={auth.error} retry={() => auth.refetch()} />
  if (launchInviteToken) return <InviteGate
    token={launchInviteToken}
    onClose={() => setInviteHandled(true)}
    onAccepted={(result) => {
      setWorkspaceId(result.workspaceId)
      setAccountId(result.accountId)
      setInviteHandled(true)
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
      setToast({ text: 'Общий кошелёк подключён' })
    }}
  />
  if (snapshot.isPending) return <Loading />
  if (snapshot.isError || !data) return <AuthError error={snapshot.error} retry={() => snapshot.refetch()} />
  if (editor) return <>
    {page === 'home' && <div className="receding-under editor-underlay" aria-hidden="true"><HomeLayer data={data} totalBalance={totalBalance} period={period} setPeriod={setPeriod} receding={false} onEditor={setEditor} onInsights={openInsights} onNavigate={navigate} onDelete={scheduleDelete} onLoadMore={requestMoreTransactions} loadingMore={loadMore.isPending} /></div>}
    <TransactionEditor closing={editorClosing} data={data} state={editor} onClose={closeEditor} onSaved={() => { refresh(); haptic('success'); setToast({ text: 'Операция сохранена' }); closeEditor() }} onDelete={scheduleDelete} />
  </>

  return <main className={`app-shell${page !== 'home' ? ' overlay-shell' : ''}${navigationMotion !== 'idle' ? ` motion-${navigationMotion}` : ''}`}>
    {(receding || page === 'insights') && page !== 'home' && <div className={`receding-under${page === 'insights' ? ' peeking' : ''}`} inert aria-hidden="true"><HomeLayer data={data} totalBalance={totalBalance} period={period} setPeriod={setPeriod} receding onEditor={setEditor} onInsights={openInsights} onNavigate={navigate} onDelete={scheduleDelete} onLoadMore={requestMoreTransactions} loadingMore={loadMore.isPending} /></div>}
    {page === 'home' && <HomeLayer data={data} totalBalance={totalBalance} period={period} setPeriod={setPeriod} receding={receding} onEditor={setEditor} onInsights={openInsights} onNavigate={navigate} onDelete={scheduleDelete} onLoadMore={requestMoreTransactions} loadingMore={loadMore.isPending} />}
    {page === 'insights' && <InsightsPage data={data} period={period} setPeriod={setPeriod} onClose={goBack} />}
    {page === 'analytics' && <AnalyticsPage
      data={data}
      period={period}
      setPeriod={setPeriod}
      onClose={goBack}
      glyph={(icon) => <CategoryGlyph icon={icon ?? undefined} />}
      onShare={(text) => { void navigator.clipboard?.writeText(text); haptic('success'); setToast({ text: 'Сводка скопирована' }) }}
    />}
    {page === 'accounts' && <AccountsPage data={data} workspace={activeWorkspace} onSelect={async (nextWorkspaceId, nextAccountId) => { await selectAccount(nextWorkspaceId, nextAccountId); goBack() }} onResetScope={resetAccountScope} onRefresh={refresh} notify={(text) => setToast({ text })} onClose={goBack} />}
    {page === 'search' && <SearchPage data={data} glyph={(icon) => <CategoryGlyph icon={icon} />} onEdit={(transaction) => setEditor({ mode: 'edit', transaction })} onClose={goBack} periodLabel={range.label} />}
    {page === 'family' && <FamilyPage data={data} onSelect={selectAccount} onResetScope={resetAccountScope} onRefresh={refresh} notify={(text) => setToast({ text })} onClose={goBack} />}
    {page === 'settings' && <SettingsPage backRef={settingsBackRef} notify={(text) => setToast({ text })} onNavigate={navigate} onClose={goBack} />}
    {page === 'categories' && <CategoriesPage data={data} onRefresh={refresh} notify={(text) => setToast({ text })} onClose={goBack} />}
    {toast && <ToastNotice key={`${toast.text}:${toast.action || ''}`} toast={toast} onDismiss={() => setToast(null)} />}
  </main>
}


/**
 * Drag-down gesture that opens Insights, mirroring the reference: while the finger
 * is down the "Инсайты" pill morphs into a growing tile and the list slides away;
 * past the threshold the home screen recedes and the sheet takes over.
 */
const PULL_THRESHOLD = 96

function usePullToOpen(onOpen: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const open = useRef(onOpen)
  useEffect(() => { open.current = onOpen })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    let startY: number | null = null
    let engaged = false
    let value = 0
    let tick = 0

    const atTop = () => (window.scrollY || document.documentElement.scrollTop) <= 1
    const setValue = (next: number) => {
      value = next
      setProgress(next)
      // A tick every quarter of the pull, like the iOS pickers.
      const step = Math.floor(next * 4)
      if (step !== tick) { tick = step; if (next > 0) haptics.selection() }
    }

    const onStart = (event: TouchEvent) => {
      if (!atTop() || event.touches.length !== 1) return
      startY = event.touches[0].clientY
      engaged = false
    }
    const onMove = (event: TouchEvent) => {
      if (startY === null) return
      const delta = event.touches[0].clientY - startY
      if (!engaged) {
        // Claim the gesture only once it is clearly a downward pull from the top;
        // until then the browser keeps it and the list scrolls normally.
        if (delta < 8) return
        if (!atTop()) { startY = null; return }
        engaged = true
      }
      // Non-passive listener: this is what stops the browser from stealing the
      // drag and cancelling the gesture half-way through a slow swipe.
      event.preventDefault()
      setValue(Math.min(1.4, delta / PULL_THRESHOLD))
    }
    const onEnd = () => {
      if (startY === null) return
      const reached = engaged && value >= 1
      startY = null
      engaged = false
      setValue(0)
      if (reached) { haptics.notify('success'); open.current() }
    }

    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove', onMove, { passive: false })
    node.addEventListener('touchend', onEnd)
    node.addEventListener('touchcancel', onEnd)
    return () => {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return [ref, progress] as const
}

function HomeLayer({ data, totalBalance, period, setPeriod, receding, onEditor, onInsights, onNavigate, onDelete, onLoadMore, loadingMore }: {
  data: AppSnapshot; totalBalance: number; period: PeriodSelection; setPeriod(next: PeriodSelection): void; receding: boolean
  onEditor(state: EditorState): void; onInsights(): void; onNavigate(page: PageKey): void
  onDelete(item: TransactionView): void
  onLoadMore(): void; loadingMore: boolean
}) {
  const [pullRef, pullProgress] = usePullToOpen(onInsights)
  return <div
    ref={pullRef}
    className={`home-layer${receding ? ' receding' : ''}${pullProgress > 0 ? ' pulling' : ''}`}
    style={{ '--pull': pullProgress } as CSSProperties}
  >
    <Header data={data} totalBalance={totalBalance} onSearch={() => onNavigate('search')} onSettings={() => onNavigate('settings')} onAnalytics={() => onNavigate('analytics')} onAccounts={() => onNavigate('accounts')} />
    <HomePage data={data} period={period} setPeriod={setPeriod} onEditor={onEditor} onInsights={onInsights} onDelete={onDelete} onLoadMore={onLoadMore} loadingMore={loadingMore} pull={pullProgress} finishGift={receding} />
    <FloatingActions onAdd={() => onEditor({ mode: 'create', type: 'expense' })} />
  </div>
}

function Header({ data, totalBalance, onSearch, onSettings, onAnalytics, onAccounts }: { data: AppSnapshot; totalBalance: number; onSearch(): void; onSettings(): void; onAnalytics(): void; onAccounts(): void }) {
  const activeAccount = data.activeAccountId ? data.accounts.find((item) => item.id === data.activeAccountId) : null
  const shared = Boolean(activeAccount && activeAccount.memberCount > 1)
  return <header className="topbar"><button className={`account-pill workspace-picker${shared ? ' shared' : ''}`} onClick={onAccounts}><span className="account-icon"><WalletCards size={20} />{shared && <span className="shared-wallet-badge" aria-label="Общий кошелёк"><Users /></span>}</span><span><strong>{activeAccount?.name || 'Все счета'}</strong><small>{money(totalBalance)}{shared ? ` · Общий · ${activeAccount!.memberCount}` : ''}</small></span></button><div className="header-actions"><button aria-label="Поиск" onClick={onSearch}><Search /></button><button aria-label="Аналитика" onPointerDown={warmAnalyticsChart} onClick={onAnalytics}><PieChartIcon /></button></div><button className="icon-button glass" type="button" aria-label="Настройки" onClick={onSettings}><Settings size={22} /></button></header>
}

const OPERATIONS_PAGE_SIZE = 20

function HomePage({ data, period, setPeriod, onEditor, onInsights, onDelete, onLoadMore, loadingMore, pull = 0, finishGift = false }: { data: AppSnapshot; period: PeriodSelection; setPeriod(next: PeriodSelection): void; onEditor(state: EditorState): void; onInsights(): void; onDelete(item: TransactionView): void; onLoadMore(): void; loadingMore: boolean; pull?: number; finishGift?: boolean }) {
  const grouped = useMemo(() => { const map = new Map<string, TransactionView[]>(); data.transactions.forEach((item) => { const key = format(parseISO(item.occurredAt), 'yyyy-MM-dd'); map.set(key, [...(map.get(key) || []), item]) }); return [...map.entries()] }, [data.transactions])
  const categoryMap = new Map(data.categories.map((item) => [item.id, item]))
  return <><section className="balance-card"><div className="balance-period"><span>Баланс за</span><PeriodPill value={period} onChange={setPeriod} /></div><h1>{money(data.summary.netKopecks)}</h1><div className="money-flow"><span className="income"><ArrowDownLeft size={15} />{money(data.summary.incomeKopecks)}</span><span className="expense"><ArrowUpRight size={15} />{money(data.summary.expenseKopecks)}</span></div><button className="insights-button" type="button" onPointerDown={warmInsightsChart} onClick={onInsights}><PullShape pull={pull} /><GiftMark progress={pull} finish={finishGift} /><span>Инсайты</span></button></section>
    <section className="operations-section">{grouped.length === 0 ? <Empty icon={<ReceiptText />} title="Здесь появятся операции" text="Добавьте первый доход или расход — остатки и аналитика пересчитаются сразу." /> : <>{grouped.map(([date, items]) => <div className="day-group" key={date}><div className="section-heading"><h2>{`${dayTitle(parseISO(date))}${isSameDay(parseISO(date), new Date()) ? ' - Сегодня' : ''}`}</h2><span className={items.reduce((sum, item) => sum + (item.type === 'income' ? item.amountKopecks : item.type === 'expense' ? -item.amountKopecks : 0), 0) >= 0 ? 'positive' : ''}>{money(items.reduce((sum, item) => sum + (item.type === 'income' ? item.amountKopecks : item.type === 'expense' ? -item.amountKopecks : 0), 0), true)}</span></div><div className="operation-list">{items.map((item) => { const category = categoryMap.get(item.categoryId || ''); const account = data.accounts.find((candidate) => candidate.id === item.accountId); return <OperationRow key={item.id} item={item} category={category} shared={Boolean(account && account.memberCount > 1)} onOpen={() => onEditor({ mode: 'edit', transaction: item })} onDelete={() => onDelete(item)} /> })}</div></div>)}{data.transactionsNextCursor && <div className="load-more-row"><button className="secondary-button wide" type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <><LoaderCircle className="spin" />Загружаем</> : 'Показать ещё'}</button></div>}</>}</section></>
}

function FloatingActions({ onAdd }: { onAdd(): void }) {
  return <div className="floating-actions">
    <button className="primary" type="button" aria-label="Добавить операцию" onClick={() => { haptic(); onAdd() }}><Plus /></button>
  </div>
}

/** Renders a category icon from the inlined sprite by its stored lucide id. */
/**
 * One journal row. Swiping it left uncovers a delete button; releasing past the
 * commit point removes the operation, which the Undo toast can still put back.
 */
function OperationRow({ item, category, shared, onOpen, onDelete }: {
  item: TransactionView
  category?: AppSnapshot['categories'][number]
  shared: boolean
  onOpen(): void
  onDelete(): void
}) {
  const { row, offset, settling, revealed, close } = useSwipeToDelete(onDelete)
  return <div
    className={`operation-swipe${settling ? ' settling' : ''}${revealed ? ' revealed' : ''}`}
    ref={row}
    style={{ '--swipe': `${offset}px` } as CSSProperties}
  >
    <button type="button" className="operation-delete" aria-label="Удалить операцию" onClick={() => { close(); onDelete() }}><Trash2 /></button>
    <button className="operation-row" type="button" onClick={() => (revealed ? close() : onOpen())}>
      <span className="category-icon" style={tileStyle(category?.color)}>{item.type === 'transfer' ? <ArrowRightLeft /> : <CategoryGlyph icon={category?.icon} />}</span>
      <span className="operation-copy">
        <span className="operation-heading">
          <strong>{category?.name || (item.type === 'transfer' ? 'Перевод' : 'Без категории')}</strong>
          {shared && <small className="operation-author" aria-label={`Добавил ${item.authorName}`}>{item.authorName}</small>}
        </span>
        {item.note && <small>{item.note}</small>}
      </span>
      <strong className={item.type}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{money(item.amountKopecks)}</strong>
    </button>
  </div>
}

function CategoryGlyph({ icon }: { icon?: string }) {
  const id = icon && ICON_IDS.includes(icon) ? icon : FALLBACK_ICON
  // An icon outside the inlined core pulls the rest of the sprite in once, then
  // re-renders so the symbol it needs is there to reference.  Until the request
  // completes keep the already-inlined neutral glyph visible rather than leaving
  // an empty tile for a frame on a cold mobile connection.
  const [, redraw] = useState(0)
  useEffect(() => {
    if (isCoreIcon(id) || isIconLibraryReady()) return
    let alive = true
    void ensureIconLibrary().then(() => { if (alive) redraw((value) => value + 1) })
    return () => { alive = false }
  }, [id])
  const visibleId = isCoreIcon(id) || isIconLibraryReady() ? id : FALLBACK_ICON
  return <svg className="glyph" aria-hidden="true"><use href={`#i-${visibleId}`} /></svg>
}

/** A category carries one saturated colour; the tile behind the glyph is derived from it. */
const tileStyle = (color?: string) => ({ background: tint(color), color: color || DATA_COLORS.glyphFallback })

function dayTitle(date: Date) { const weekdays = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']; return `${weekdays[date.getDay()]}, ${format(date, 'd MMMM', { locale: ru })}` }

function InsightsPage({ data, period, setPeriod, onClose }: { data: AppSnapshot; period: PeriodSelection; setPeriod(next: PeriodSelection): void; onClose(): void }) {
  // The chart's x axis follows whatever window is selected: days for short ranges,
  // months once the period is long enough that daily ticks stop being readable.
  const range = resolvePeriod(period)
  const byMonth = trendGranularity(range) === 'month'
  const now = new Date()
  const bucketCount = byMonth
    ? differenceInCalendarMonths(range.end, range.start) + 1
    : differenceInCalendarDays(range.end, range.start) + 1
  const bucketOf = (date: Date) => byMonth
    ? differenceInCalendarMonths(date, range.start) + 1
    : differenceInCalendarDays(date, range.start) + 1

  const spending = new Map<number, number>()
  for (const item of data.summary.trend) {
    const at = parseISO(item.date.length === 7 ? `${item.date}-01` : item.date)
    const slot = bucketOf(at)
    spending.set(slot, (spending.get(slot) || 0) + item.expenseKopecks / 100)
  }

  const lastFilled = spending.size ? Math.max(...spending.keys()) : 1
  const elapsed = now >= range.end ? bucketCount : Math.max(1, bucketOf(now))
  const cutoffDay = Math.min(bucketCount, Math.max(lastFilled, elapsed))

  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const day = index + 1
    let cumulative = 0
    for (const [slot, amount] of spending) if (slot <= day) cumulative += amount
    return {
      day,
      expense: day <= cutoffDay ? cumulative : null,
      forecast: day >= cutoffDay ? data.summary.expenseKopecks / 100 : null,
    }
  })
  const chartMaximum = Math.max(1_000, Math.ceil((data.summary.expenseKopecks / 100) / 1_000) * 1_000)
  const chartTicks = [0, Math.round(chartMaximum / 3), Math.round(chartMaximum * 2 / 3), chartMaximum]
  // The peak day now comes from the summary, which tracks calendar days even when
  // the chart itself is bucketing months - the tile says "day" and must mean it.
  const peakLabel = data.summary.mostExpensiveDay
    ? format(parseISO(data.summary.mostExpensiveDay), 'd MMMM', { locale: ru })
    : '—'
  const largestExpenseCategory = data.categories.find((item) => item.id === data.summary.largestExpenseCategoryId)
  const largestIncomeCategory = data.categories.find((item) => item.id === data.summary.largestIncomeCategoryId)
  const mostFrequentExpenseCategory = data.categories.find((item) => item.id === data.summary.mostFrequentExpenseCategoryId)
  const balance = data.accounts.filter((item) => item.workspaceId === data.activeWorkspaceId && (!data.activeAccountId || item.id === data.activeAccountId)).reduce((sum, item) => sum + item.balanceKopecks, 0)
  const monthlyBurn = data.summary.expenseKopecks > 0
    ? data.summary.expenseKopecks / (data.summary.elapsedDays / 30.44)
    : 0
  const runwayValue = monthlyBurn > 0 ? balance / monthlyBurn : 0
  const runway = runwayValue > 0 ? runwayValue.toFixed(1) : '0'
  // The bar under the balance shows how much of the income survived the period, so
  // it has to be driven by that number rather than a fixed split.
  const insightsReliable = hasReliableInsightSample(data.summary.observedDayCount)
  const savedShare = savedIncomePercent(data.summary.incomeKopecks, data.summary.expenseKopecks, data.summary.netKopecks)
  const savingLabel = !insightsReliable
    ? 'Пока мало данных'
    : data.summary.netKopecks < 0
    ? data.summary.incomeKopecks
      ? `Расходы выше дохода на ${Math.round((-data.summary.netKopecks / data.summary.incomeKopecks) * 100)}%`
      : 'Расходы без дохода'
    : `Сохранено ${savedShare}% дохода`
  return <div className="insights-screen"><button type="button" className="close-orb insights-back" aria-label="Назад" onClick={onClose}><ChevronLeft /></button><div className="insights-balance"><PeriodPill value={period} onChange={setPeriod} tone="frost" /><strong>{money(data.summary.netKopecks)}</strong><div className="saving-line" style={{ '--saved': `${savedShare}%` } as CSSProperties}><i /><span><HandCoins />{savingLabel}</span></div></div><Suspense fallback={<section className="insights-chart placeholder" />}><InsightsChart trend={trend} daysInMonth={bucketCount} cutoffDay={cutoffDay} maximum={chartMaximum} ticks={chartTicks} totalKopecks={data.summary.expenseKopecks} /></Suspense><section className="insight-tiles">
      <InsightTile title="Средние траты в день" icon={<CalendarDays />} sign="out" value={moneyExact(data.summary.averageExpensePerDayKopecks)} />
      <InsightTile title="Самая большая трата" note={largestExpenseCategory?.name || 'Без категории'} value={money(data.summary.largestExpenseKopecks)} tone="warm">
        {largestExpenseCategory
          ? <span className="tile-category" style={tileStyle(largestExpenseCategory.color)}><CategoryGlyph icon={largestExpenseCategory.icon} /></span>
          : <span className="tile-category neutral"><CircleSlash2 /></span>}
      </InsightTile>
      <InsightTile title="Самый большой доход" note={largestIncomeCategory?.name || 'Без категории'} value={money(data.summary.largestIncomeKopecks)} tone="green">
        {largestIncomeCategory
          ? <span className="tile-category" style={tileStyle(largestIncomeCategory.color)}><CategoryGlyph icon={largestIncomeCategory.icon} /></span>
          : <span className="tile-category neutral"><CircleSlash2 /></span>}
      </InsightTile>
      <InsightTile title="Самый дорогой день" icon={<ShoppingBag />} sign="out" note={peakLabel} value={money(data.summary.mostExpensiveDayKopecks)} />
      <InsightTile title="Серия без трат" icon={<Flame className="hot" />} note={insightsReliable ? `${data.summary.expenseFreeStreakDays} ${plural(data.summary.expenseFreeStreakDays, 'день', 'дня', 'дней')} подряд без трат` : 'Пока мало данных'} value={insightsReliable ? String(data.summary.expenseFreeStreakDays) : '—'} />
      <InsightTile title="Траты в выходные" icon={<Umbrella />} note={insightsReliable ? `${data.summary.weekendExpenseSharePercent}% трат приходится на выходные` : 'Пока мало данных'} value={insightsReliable ? `${data.summary.weekendExpenseSharePercent}%` : '—'} />
      <InsightTile title="Количество операций" note="Операций за выбранный период" value={String(data.summary.operationCount)} />
      <InsightTile title="Самая частая категория" note={mostFrequentExpenseCategory?.name || 'Без категории'} value={String(data.summary.mostFrequentExpenseCategoryCount)} icon={mostFrequentExpenseCategory ? <span className="tile-category" style={tileStyle(mostFrequentExpenseCategory.color)}><CategoryGlyph icon={mostFrequentExpenseCategory.icon} /></span> : <span className="tile-category neutral"><CircleSlash2 /></span>} />
      <InsightTile title="Подушка безопасности" icon={<RectangleHorizontal className="safe" />} note={`Текущих средств хватит на ${runway} мес. расходов`} value={runway} />
    </section></div>
}

type AccountSwitchProps = {
  onSelect(workspaceId: string, accountId: string | null): Promise<void>
  onResetScope(): void
}

function AccountsPage({ data, workspace, onSelect, onResetScope, onRefresh, notify, onClose }: ActionProps & AccountSwitchProps & { workspace?: AppSnapshot['workspaces'][number]; onClose(): void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [editing, setEditing] = useState<AccountView | null>(null)
  const [editName, setEditName] = useState('')
  const activeAccounts = data.accounts.filter((item) => !item.archivedAt)
  const ownedAccounts = activeAccounts.filter((item) => item.accessRole === 'owner')
  const workspaceAccounts = activeAccounts.filter((item) => item.workspaceId === data.activeWorkspaceId)
  const total = workspaceAccounts.reduce((sum, item) => sum + item.balanceKopecks, 0)
  const select = useMutation({
    mutationFn: (account: AccountView | null) => onSelect(account?.workspaceId || data.activeWorkspaceId, account?.id || null),
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось переключить кошелёк'),
  })
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/accounts', { method: 'POST', body: JSON.stringify({ workspaceId: data.activeWorkspaceId, name, kind: 'cash', icon: 'wallet', color: DATA_COLORS.accountDefault, openingBalanceKopecks: Math.round(Number(openingBalance.replace(',', '.')) * 100) }) }),
    onSuccess: async (result) => {
      setOpen(false); setName(''); setOpeningBalance('0'); notify('Кошелёк создан')
      await onSelect(data.activeWorkspaceId, result.id)
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось создать кошелёк'),
  })
  const rename = useMutation({
    mutationFn: () => editing ? api(`/accounts/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: editName, version: editing.version }) }) : Promise.resolve(),
    onSuccess: () => { setEditing(null); onRefresh(); notify('Кошелёк переименован') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось переименовать кошелёк'),
  })
  const archive = useMutation({
    mutationFn: (account: AccountView) => api(`/accounts/${account.id}?version=${account.version}`, { method: 'DELETE' }),
    onSuccess: () => { setEditing(null); onResetScope(); notify('Кошелёк удалён') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось удалить кошелёк'),
  })
  return <div className="accounts-screen">
    <header className="centered-overlay-header"><button className="close-orb" type="button" aria-label="Назад" onClick={onClose}><ChevronLeft /></button><h1>Счета</h1>{workspace?.role === 'owner' ? <button className="action-orb" type="button" aria-label="Новый кошелёк" onClick={() => setOpen(!open)}><Plus /></button> : <span />}</header>
    {open && <InlineForm onSubmit={(event) => { event.preventDefault(); create.mutate() }}><Field label="Название"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Новый кошелёк" required /></Field><Field label="Начальный остаток, ₽"><input value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} inputMode="decimal" /></Field><Submit pending={create.isPending}>Создать кошелёк</Submit></InlineForm>}
    <button className={`all-accounts-row${data.activeAccountId === null ? ' active' : ''}`} type="button" disabled={select.isPending} onClick={() => select.mutate(null)}><strong>Все счета</strong><span>{money(total)}</span>{data.activeAccountId === null && <Check />}</button>
    <div className="reference-account-list">{activeAccounts.map((account) => {
      const isEditing = editing?.id === account.id
      const canDelete = ownedAccounts.length > 1
      return <article className={`${account.id === data.activeAccountId ? 'active' : ''}${account.memberCount > 1 ? ' shared' : ''}${isEditing ? ' editing' : ''}`} key={account.id}>
        <button className="account-select" type="button" disabled={select.isPending} onClick={() => select.mutate(account)}><span className="account-icon">{account.memberCount > 1 ? <><WalletCards /><span className="shared-wallet-badge" aria-label="Общий кошелёк"><Users /></span></> : <WalletCards />}</span><span className="account-row-copy"><strong>{account.name}</strong><small>{account.memberCount > 1 ? `Общий · ${account.memberCount} участника · ${account.accessRole === 'owner' ? 'владелец' : 'редактор'}` : account.accessRole === 'owner' ? 'Личный кошелёк' : 'Доступ на редактирование'}</small></span><b>{money(account.balanceKopecks)}</b>{account.id === data.activeAccountId && <Check className="account-selected-mark" />}</button>
        {account.accessRole === 'owner' && <button className={`account-edit${isEditing ? ' active' : ''}`} type="button" aria-label={`Управлять кошельком ${account.name}`} onClick={() => { setEditing(isEditing ? null : account); setEditName(account.name); setOpen(false) }}><Pencil /></button>}
        {isEditing && <form className="inline-form account-manage-form" onSubmit={(event) => { event.preventDefault(); rename.mutate() }}>
          <Field label="Название кошелька"><input value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus required /></Field>
          <Submit pending={rename.isPending}>Сохранить</Submit>
          <button className="danger-text-button" type="button" disabled={!canDelete || archive.isPending} title={canDelete ? 'Удалить кошелёк' : 'Нельзя удалить единственный личный кошелёк'} onClick={() => { if (window.confirm(`Удалить кошелёк «${account.name}»? Операции останутся в истории, но кошелёк больше нельзя будет выбрать.`)) archive.mutate(account) }}><Trash2 />{canDelete ? 'Удалить кошелёк' : 'Единственный кошелёк'}</button>
        </form>}
      </article>
    })}</div>
  </div>
}

type InviteResult = { id: string; token: string; expiresAt: string; url: string }

function FamilyPage({ data, onSelect, onResetScope, onRefresh, notify, onClose }: ActionProps & AccountSwitchProps & { onClose(): void }) {
  const [invite, setInvite] = useState<string | null>(null)
  const activeAccount = data.activeAccountId ? data.accounts.find((item) => item.id === data.activeAccountId && !item.archivedAt) : null
  const accounts = data.accounts.filter((item) => !item.archivedAt)
  const switchAccount = useMutation({
    mutationFn: (account: AccountView) => onSelect(account.workspaceId, account.id),
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось открыть кошелёк'),
  })
  const makeInvite = useMutation({
    mutationFn: () => api<InviteResult>(`/accounts/${activeAccount!.id}/invites`, { method: 'POST', body: JSON.stringify({ role: 'editor' }) }),
    onSuccess: (result) => {
      setInvite(result.url)
      if (!shareTelegramLink(result.url, `Приглашаю вместе вести кошелёк «${activeAccount?.name || ''}» в Lomme.`)) {
        notify('Не удалось открыть список чатов. Скопируйте запасную ссылку ниже.')
      }
    },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось создать приглашение'),
  })
  const removeMember = useMutation({
    mutationFn: (memberUserId: string) => api(`/accounts/${activeAccount!.id}/members/${memberUserId}`, { method: 'DELETE' }),
    onSuccess: () => { onRefresh(); notify('Доступ участника закрыт') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось закрыть доступ'),
  })
  const leave = useMutation({
    mutationFn: () => api(`/accounts/${activeAccount!.id}/leave`, { method: 'POST', body: '{}' }),
    onSuccess: () => { onResetScope(); notify('Вы вышли из общего кошелька') },
    onError: (cause) => notify(cause instanceof Error ? cause.message : 'Не удалось выйти из кошелька'),
  })
  return <div className="family-screen"><header className="centered-overlay-header"><button className="close-orb" type="button" aria-label="Назад" onClick={onClose}><ChevronLeft /></button><h1>Семья</h1><span /></header><p className="screen-subtitle">Выберите существующий кошелёк и откройте совместный доступ</p>
    <Card title="Кошелёк"><div className="family-account-list">{accounts.map((account) => <button className={account.id === activeAccount?.id ? 'active' : ''} type="button" key={account.id} disabled={switchAccount.isPending} onClick={() => switchAccount.mutate(account)}><span className="account-icon">{account.memberCount > 1 ? <><WalletCards /><span className="shared-wallet-badge" aria-label="Общий кошелёк"><Users /></span></> : <WalletCards />}</span><span><strong>{account.name}</strong><small>{account.accessRole === 'owner' ? 'Ваш кошелёк' : 'Вас пригласили'}{account.memberCount > 1 ? ` · Общий · ${account.memberCount} участника` : ''}</small></span>{account.id === activeAccount?.id ? <Check /> : null}</button>)}</div></Card>
    {!activeAccount ? <Card title="Сначала выберите кошелёк"><p className="card-copy">Совместный доступ включается для одного конкретного кошелька, а не для всех ваших финансов.</p></Card> : <>
      <Card title={`Участники · ${data.members.length}`}><div className="member-list">{data.members.map((member) => <div key={member.userId}><span>{member.firstName.slice(0, 1)}</span><p><strong>{member.firstName}</strong><small>{member.username ? `@${member.username}` : member.role === 'owner' ? 'Владелец' : 'Редактор'}</small></p><em>{member.role === 'owner' ? 'Владелец' : 'Редактор'}</em>{activeAccount.accessRole === 'owner' && member.role === 'editor' && <button className="member-remove" type="button" aria-label={`Удалить ${member.firstName} из кошелька`} disabled={removeMember.isPending} onClick={() => { if (window.confirm(`Удалить ${member.firstName} из кошелька «${activeAccount.name}»? Пользователь сразу потеряет доступ к операциям.`)) removeMember.mutate(member.userId) }}><UserMinus /><span>Удалить</span></button>}</div>)}</div>
        {activeAccount.accessRole === 'owner' ? <><button className="primary-button wide" type="button" disabled={makeInvite.isPending} onClick={() => makeInvite.mutate()}>{makeInvite.isPending ? <LoaderCircle className="spin" /> : <UserPlus />}Выбрать получателя в Telegram</button><p className="native-share-note">Откроется нативный список чатов — копировать и пересылать ссылку не нужно.</p></> : <button className="danger-text-button wide" type="button" disabled={leave.isPending} onClick={() => { if (window.confirm(`Выйти из общего кошелька «${activeAccount.name}»?`)) leave.mutate() }}><Trash2 />Выйти из кошелька</button>}
      </Card>
      {invite && <Card title="Запасная ссылка · действует 24 часа"><div className="invite-link">{invite}</div><button className="secondary-button wide" type="button" onClick={async () => notify(await copyText(invite) ? 'Ссылка скопирована' : 'Не удалось скопировать')}><Check />Скопировать ссылку</button></Card>}
    </>}
  </div>
}

function InviteGate({ token, onAccepted, onClose }: { token: string; onAccepted(result: { workspaceId: string; accountId: string }): void; onClose(): void }) {
  const [accepted, setAccepted] = useState<{ workspaceId: string; accountId: string } | null>(null)
  const preview = useQuery<AccountInvitePreview>({ queryKey: ['account-invite', token], queryFn: () => api('/account-invites/preview', { method: 'POST', body: JSON.stringify({ token }) }), retry: false })
  const accept = useMutation({
    mutationFn: () => api<{ workspaceId: string; accountId: string }>('/account-invites/accept', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: setAccepted,
  })
  const statusText = preview.data?.status === 'expired' ? 'Срок приглашения истёк' : preview.data?.status === 'revoked' ? 'Приглашение отозвано' : preview.data?.status === 'accepted' ? 'Приглашение уже использовано' : null
  if (accepted && preview.data) return <main className="app-shell overlay-shell"><div className="invite-gate family-screen"><header className="centered-overlay-header"><span /><h1>Готово</h1><span /></header>
    <Card title="Вы добавлены"><div className="invite-wallet-mark invite-success-mark"><span className="account-icon"><Users /></span><p><strong>{preview.data.accountName}</strong><small>Общий кошелёк теперь доступен вам. Вы можете вместе добавлять и редактировать операции.</small></p></div><button className="primary-button wide" type="button" onClick={() => onAccepted(accepted)}><Check />Открыть общий кошелёк</button></Card>
  </div></main>
  return <main className="app-shell overlay-shell"><div className="invite-gate family-screen"><header className="centered-overlay-header"><button className="close-orb" type="button" aria-label="Закрыть" onClick={onClose}><ChevronLeft /></button><h1>Приглашение</h1><span /></header>
    {preview.isPending ? <div className="invite-loading" role="status"><LoaderCircle className="spin" /><strong>Открываем приглашение…</strong><span>Проверяем доступ к общему кошельку</span></div> : preview.isError ? <Card title="Не удалось открыть приглашение"><p className="card-copy">Приглашение не загрузилось. Попробуйте ещё раз — приложение не останется на белом экране.</p><button className="primary-button wide" type="button" onClick={() => preview.refetch()}><LoaderCircle />Попробовать ещё раз</button><button className="secondary-button wide" type="button" onClick={onClose}>Вернуться в Lomme</button></Card> : <Card title="Вас пригласили в общий кошелёк"><div className="invite-wallet-mark"><span className="account-icon"><Users /></span><p><strong>{preview.data!.accountName}</strong><small>{preview.data!.inviterName} приглашает вас вместе вести этот кошелёк. Остальные ваши кошельки останутся личными.</small></p></div>{statusText && preview.data!.status !== 'accepted' ? <p className="form-error">{statusText}</p> : <button className="primary-button wide" type="button" disabled={accept.isPending} onClick={() => accept.mutate()}>{accept.isPending ? <LoaderCircle className="spin" /> : <Check />}{preview.data!.status === 'accepted' ? 'Открыть кошелёк' : 'Присоединиться'}</button>}{accept.isError && <p className="form-error">{accept.error.message}</p>}<button className="secondary-button wide" type="button" onClick={onClose}>Не сейчас</button></Card>}
  </div></main>
}

function TransactionEditor({ data, state, closing, onClose, onSaved, onDelete }: { data: AppSnapshot; state: EditorState; closing: boolean; onClose(): void; onSaved(): void; onDelete(item: TransactionView): void }) {
  const editing = state.mode === 'edit' ? state.transaction : null
  const [type, setType] = useState<TransactionType>(editing?.type || (state.mode === 'create' ? state.type : 'expense'))
  const [calc, setCalc] = useState(() => initialCalc(editing ? fromKopecks(editing.amountKopecks) : '0'))
  const amountKopecks = resolveKopecks(calc)
  const availableAccounts = data.accounts.filter((item) => !item.archivedAt && item.workspaceId === data.activeWorkspaceId)
  const [accountId, setAccountId] = useState(editing?.accountId || data.activeAccountId || availableAccounts[0]?.id || ''); const [targetAccountId, setTargetAccountId] = useState(editing?.targetAccountId || availableAccounts.find((item) => item.id !== (editing?.accountId || data.activeAccountId))?.id || '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId || ''); const [occurredAt, setOccurredAt] = useState(editing ? toLocalDateTimeInput(editing.occurredAt) : todayInput()); const [note, setNote] = useState(editing?.note || ''); const [error, setError] = useState('')
  const categories = byUsage(data.categories, type === 'income' ? 'income' : 'expense', data.transactions)
  const selectedCategoryId = categories.some((item) => item.id === categoryId) ? categoryId : ''
  const idempotencyKey = useRef(crypto.randomUUID())
  const submitting = useRef(false)
  const mutation = useMutation({ mutationFn: async () => { const body = { workspaceId: data.activeWorkspaceId, type, amountKopecks, accountId, targetAccountId: type === 'transfer' ? targetAccountId : null, categoryId: type === 'transfer' || !selectedCategoryId ? null : selectedCategoryId, occurredAt: fromLocalDateTimeInput(occurredAt), note, source: 'manual' as const }; if (editing) { const { workspaceId: _, source: __, ...update } = body; return api(`/transactions/${editing.id}`, { method: 'PUT', body: JSON.stringify({ ...update, version: editing.version }) }) } return api('/transactions', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey.current }, body: JSON.stringify(body) }) }, onSuccess: onSaved, onError: (cause) => setError(cause instanceof Error ? cause.message : 'Не удалось сохранить'), onSettled: () => { submitting.current = false } })
  const save = () => {
    if (submitting.current) return
    submitting.current = true
    mutation.mutate()
  }
  const key = (value: CalcKey) => { haptic(); setCalc((current) => pressKey(current, value)) }
  const account = data.accounts.find((item) => item.id === accountId)

  return <main className={`app-shell editor-shell${closing ? ' motion-exit-sheet' : ''}`}>
    <header className="reference-editor-header"><button type="button" className="close-orb" aria-label="Назад" onClick={onClose}><ChevronLeft /></button><div className="editor-type-switch"><button className={type === 'income' ? 'active income' : 'income'} onClick={() => { setType('income'); setCategoryId('') }}><ArrowDownLeft /><span>Доход</span></button><button className={type === 'expense' ? 'active expense' : 'expense'} onClick={() => { setType('expense'); setCategoryId('') }}><ArrowUpRight /><span>Расход</span></button>{type === 'transfer' && <strong>Перевод</strong>}</div>{editing ? <button className="action-orb" aria-label="Удалить операцию" onClick={() => onDelete(editing)}><Trash2 /></button> : <span />}</header>
    <section className={`reference-amount ${type}`}><strong><AmountDigits value={calc.entry} /> ₽</strong></section>
    <section className={`transaction-meta${type === 'transfer' ? ' is-transfer' : ''}`}>
      {type === 'transfer' && <label><span className="account-icon"><WalletCards /></span><p><strong>{account?.name}</strong><small>{money(account?.balanceKopecks || 0)}</small></p><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{availableAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {type === 'transfer' ? <label><ArrowRightLeft /><p><strong>На счёт</strong><small>{data.accounts.find((item) => item.id === targetAccountId)?.name || 'Выберите'}</small></p><select value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)}>{availableAccounts.filter((item) => item.id !== accountId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label className="date-pill"><CalendarDays aria-hidden="true" /><span>{formatOperationDateLabel(occurredAt)}</span><input type="datetime-local" aria-label="Дата и время операции" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>}
      <span className="currency-pill">₽</span>
    </section>
    <input className="reference-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Заметка" maxLength={500} />
    {type !== 'transfer' && <CategoryCarousel categories={categories} selectedId={selectedCategoryId} onSelect={setCategoryId} />}
    <div className="reference-keypad">{(['1','2','3','4','5','6','7','8','9',',','0','⌫'] as CalcKey[]).map((item) => <button type="button" key={item} onClick={() => key(item)}>{item}</button>)}</div>
    {error && <p className="form-error">{error}</p>}
    <button className="save-operation" disabled={mutation.isPending || amountKopecks <= 0 || !accountId || (type === 'transfer' && !targetAccountId)} onClick={save}>{mutation.isPending ? <LoaderCircle className="spin" /> : null}Сохранить</button>
  </main>
}


/** Matches --motion-digit, plus enough slack that the node is never dropped mid-flight. */
const DIGIT_MOTION_MS = 260

/**
 * Typed digits arrive from below-right, small and grey, then settle into place.
 * Deleted digits leave the same way, so a removed character is not just cut.
 *
 * Whatever the two values stop sharing is what leaves, which covers more than a
 * backspace: clearing 555 back to 0, or typing over a folded result, both replace
 * digits rather than trim them, and used to blink out with no animation at all. The
 * fragment leaves from where it actually stood, so the digits around it never
 * reshuffle.
 *
 * Several fragments can be in flight at once, which is what holding down backspace
 * does. Replacing the previous one instead would drop a half-collapsed box and start
 * a full-width one in the same frame - the little skip that survived the first fix.
 */
type LeavingDigits = { text: string; at: number; run: number; replaced: boolean; span: number | null }

function AmountDigits({ value }: { value: string }) {
  const [leaving, setLeaving] = useState<readonly LeavingDigits[]>([])
  const previous = useRef(value)
  const run = useRef(0)
  const timers = useRef<number[]>([])
  const nodes = useRef(new Map<number, HTMLElement>())

  useEffect(() => () => { for (const id of timers.current) window.clearTimeout(id) }, [])

  // A fragment collapses from the width it really had, measured off the node itself.
  // Deriving it from `1ch` was close but never exact - Nunito's zero is half a pixel
  // wider than the digits beside it - and starting half a pixel short is a visible
  // twitch on the first frame of every delete. Measured before paint, so the
  // fragment is only ever painted at its true width or narrower.
  useLayoutEffect(() => {
    const pending = leaving.filter((item) => item.span === null)
    if (pending.length === 0) return
    const spans = new Map(pending.map((item) => [item.run, nodes.current.get(item.run)?.getBoundingClientRect().width ?? 0]))
    setLeaving((current) => current.map((item) => (spans.has(item.run) ? { ...item, span: spans.get(item.run) ?? 0 } : item)))
  }, [leaving])

  useEffect(() => {
    const before = previous.current
    previous.current = value
    if (before === value) return
    let shared = 0
    while (shared < before.length && shared < value.length && before[shared] === value[shared]) shared += 1
    const removed = before.slice(shared)
    // Nothing left the number, so leave any fragment still in flight alone: cutting
    // one short is what made the amount jump.
    if (!removed) return
    run.current += 1
    const id = run.current
    // A replaced fragment leaves out of flow, so it needs no width of its own.
    const replaced = value.length > shared
    setLeaving((current) => [...current, { text: removed, at: shared, run: id, replaced, span: replaced ? 0 : null }])
    const timer = window.setTimeout(() => setLeaving((current) => current.filter((item) => item.run !== id)), DIGIT_MOTION_MS)
    timers.current = [...timers.current.slice(-4), timer]
  }, [value])

  const chars = [...value]
  // Fragments sit where they were deleted from, and two that were deleted from the
  // same spot keep their order: the one deleted first is the one further right.
  const placed = [...leaving].sort((a, b) => a.at - b.at || a.run - b.run)
  const cells: ReactNode[] = []
  let cursor = 0
  for (const fragment of placed) {
    const at = Math.min(fragment.at, chars.length)
    for (; cursor < at; cursor++) cells.push(<i key={`${cursor}-${chars[cursor]}`}>{chars[cursor]}</i>)
    cells.push(<i
      key={`leaving-${fragment.run}`}
      ref={(node) => { if (node) nodes.current.set(fragment.run, node); else nodes.current.delete(fragment.run) }}
      className={`leaving${fragment.replaced ? ' replaced' : ''}${fragment.span === null ? '' : ' armed'}`}
      style={fragment.span === null ? undefined : { '--leaving-span': `${fragment.span}px` } as CSSProperties}
    >{fragment.text}</i>)
  }
  for (; cursor < chars.length; cursor++) cells.push(<i key={`${cursor}-${chars[cursor]}`}>{chars[cursor]}</i>)
  return <>{cells}</>
}


/**
 * The gift that replaces the sparkle on the Insights button. Its playhead is
 * scrubbed by the pull, so dragging physically opens the box instead of playing
 * an animation that happens to run alongside the gesture.
 */
function GiftMark({ progress, finish }: { progress: number; finish: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const anim = useRef<{
    destroy(): void
    goToAndStop(v: number, isFrame: boolean): void
    playSegments(seg: [number, number], force: boolean): void
    totalFrames: number
  } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [{ default: lottie }, { default: data }] = await Promise.all([
        import('lottie-web/build/player/lottie_light'),
        import('./assets/pull-gift.json'),
      ])
      if (cancelled || !host.current) return
      anim.current = lottie.loadAnimation({
        container: host.current, renderer: 'svg', loop: false, autoplay: false, animationData: data,
      }) as unknown as typeof anim.current
      setReady(true)
    })()
    return () => { cancelled = true; anim.current?.destroy(); anim.current = null }
  }, [])

  // The box opens over frames 0-10 of 90; the rest of the clip is the bounce
  // settling back. Mapping the pull onto the whole clip would leave 90% of the
  // gesture with nothing happening, so it drives the opening only.
  const OPEN_FRAME = 10
  // Frame 31 is where the lid is back down and the box has settled; the remaining
  // 60 frames are just hold, so finishing there keeps the handover snappy.
  const CLOSE_FRAME = 31
  useEffect(() => {
    const player = anim.current
    if (!player || !ready || finish) return
    player.goToAndStop(Math.max(0, Math.min(1, progress)) * OPEN_FRAME, true)
  }, [progress, ready, finish])

  // Once the gesture commits, let the clip run out on its own so the box closes
  // instead of freezing half-open while the screen hands over.
  useEffect(() => {
    const player = anim.current
    if (!player || !ready || !finish) return
    player.playSegments([OPEN_FRAME, CLOSE_FRAME], true)
  }, [finish, ready])

  return <span className="gift-mark" ref={host} aria-hidden="true" />
}


/**
 * The tile behind the Insights button while pulling. Measured on the reference the
 * silhouette is not a rounded rectangle: the sides neck inwards at the waist
 * (104 -> 96pt) and flare at the bottom, as if the shape were being stretched.
 * Border-radius cannot express that, so the outline is drawn as a path.
 */
function PullShape({ pull }: { pull: number }) {
  if (pull <= 0) return null
  const W = 104
  const H = 25 + pull * 78
  const R = 16
  const waist = pull * 4.5          // how far each side pulls in at mid height
  const flare = pull * 1.5          // and how far the bottom pushes out
  const c = waist * 1.333           // cubic control offset that lands on `waist`
  const d = [
    `M ${R} 0`, `H ${W - R}`, `Q ${W} 0 ${W} ${R}`,
    `C ${W - c} ${H * 0.35} ${W - c + flare} ${H * 0.7} ${W + flare} ${H - R}`,
    `Q ${W + flare} ${H} ${W - R + flare} ${H}`,
    `H ${R - flare}`, `Q ${-flare} ${H} ${-flare} ${H - R}`,
    `C ${c - flare} ${H * 0.7} ${c} ${H * 0.35} 0 ${R}`,
    `Q 0 0 ${R} 0`, 'Z',
  ].join(' ')
  return <svg className="pull-shape" viewBox={`${-4} 0 ${W + 8} ${H}`} width={W + 8} height={H} aria-hidden="true">
    <defs>
      <linearGradient id="pull-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={UI_COLORS.panel} stopOpacity="0" />
        <stop offset="0.32" stopColor={UI_COLORS.panel} stopOpacity="0.1" />
        <stop offset="0.68" stopColor={UI_COLORS.panel} stopOpacity="0.5" />
        <stop offset="1" stopColor={UI_COLORS.panel} stopOpacity="1" />
      </linearGradient>
    </defs>
    <path d={d} fill="url(#pull-fill)" />
  </svg>
}


/**
 * Horizontal category picker. The reference selects whatever sits under the centre
 * of the strip rather than what you tap, so scrolling is the primary gesture and a
 * tap just scrolls that tile to the middle. The selected tile scales with a
 * transform, not a width change, so growing it cannot shove the scroll position.
 */
function CategoryCarousel({ categories, selectedId, onSelect }: {
  categories: AppSnapshot['categories']
  selectedId: string
  onSelect(id: string): void
}) {
  const NONE = '__none__'
  const strip = useRef<HTMLDivElement>(null)
  const pick = useRef(onSelect)
  const selectedRef = useRef(selectedId)
  // Set while the strip is being centred by code rather than by a finger, so the
  // scroll listener does not re-pick every tile the animation travels over.
  const driving = useRef(false)
  const frame = useRef(0)
  const settle = useRef(0)
  useEffect(() => { pick.current = onSelect })
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

  // Tile centres, measured once per layout rather than on every scroll event. This
  // is what lets the scroll handler run straight off `scrollLeft` with no layout
  // reads, so it needs no frame to throttle it.
  const midpoints = useRef<Array<{ id: string; middle: number }>>([])
  const lastPicked = useRef('')
  const remeasure = useCallback(() => {
    const node = strip.current
    if (!node) return
    midpoints.current = Array.from(node.children).flatMap((child) => {
      const element = child as HTMLElement
      return element.dataset.id ? [{ id: element.dataset.id, middle: element.offsetLeft + element.offsetWidth / 2 }] : []
    })
  }, [])

  /**
   * Selection follows whatever sits under the centre line while the strip is
   * dragged. It reacts to the scroll event directly: an earlier version deferred
   * the work to requestAnimationFrame, which never runs while the document is
   * hidden - and once its pending flag was set, the handler stopped scheduling
   * altogether and dragging silently stopped changing the category.
   */
  useEffect(() => {
    const node = strip.current
    if (!node) return
    const onScroll = () => {
      if (driving.current) return
      const centre = node.scrollLeft + node.clientWidth / 2
      let best: { id: string; distance: number } | null = null
      for (const tile of midpoints.current) {
        const distance = Math.abs(tile.middle - centre)
        if (!best || distance < best.distance) best = { id: tile.id, distance }
      }
      // Only react when the tile under the centre actually changes, so the tick
      // fires once per category rather than on every scroll event.
      if (!best || best.id === lastPicked.current) return
      lastPicked.current = best.id
      pick.current(best.id === NONE ? '' : best.id)
      // `selectionChanged()` is silently ignored by some Telegram iOS builds even
      // though the method exists. A light impact uses the same bridge as the
      // keypad feedback and produces the expected physical tick there.
      try { haptics.impact('light') } catch { /* the tick is optional; the selection is not */ }
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', remeasure)
    return () => { node.removeEventListener('scroll', onScroll); window.removeEventListener('resize', remeasure) }
  }, [remeasure])

  /**
   * Centring is animated by hand instead of with `scrollIntoView({behavior:'smooth'})`.
   * A programmatic smooth scroll is unreliable on a `scroll-snap-type: mandatory`
   * container - it can be cancelled outright, which left a tapped tile sitting
   * off-centre. Snap is lifted for the run and restored at the end, which lands
   * exactly on a snap point, so restoring it cannot jump.
   *
   * Landing is driven by a timer as well as by frames: requestAnimationFrame is
   * paused whenever the document is hidden, and the tile must end up centred even
   * then. The two paths write the same value, so whichever arrives first wins.
   */
  const CENTRE_MS = 260
  const releaseToGesture = () => {
    cancelAnimationFrame(frame.current)
    window.clearTimeout(settle.current)
    strip.current?.style.removeProperty('scroll-snap-type')
    driving.current = false
  }
  const centreOn = (id: string, animate: boolean) => {
    const node = strip.current
    const tile = node?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
    if (!node || !tile) return
    cancelAnimationFrame(frame.current)
    window.clearTimeout(settle.current)
    const limit = node.scrollWidth - node.clientWidth
    const target = Math.max(0, Math.min(tile.offsetLeft + tile.offsetWidth / 2 - node.clientWidth / 2, limit))
    const from = node.scrollLeft
    const land = () => {
      node.style.scrollSnapType = ''
      if (Math.abs(node.scrollLeft - target) >= 1) node.scrollLeft = target
      driving.current = false
    }
    if (!animate || prefersReducedMotion() || Math.abs(target - from) < 1) { land(); return }
    driving.current = true
    node.style.scrollSnapType = 'none'
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / CENTRE_MS)
      node.scrollLeft = from + (target - from) * (1 - Math.pow(1 - progress, 3))
      if (progress < 1) { frame.current = requestAnimationFrame(step); return }
      land()
    }
    frame.current = requestAnimationFrame(step)
    settle.current = window.setTimeout(land, CENTRE_MS + 60)
  }

  useEffect(() => () => { cancelAnimationFrame(frame.current); window.clearTimeout(settle.current) }, [])

  // A tap selects immediately, then the tile travels to the centre. Selection does
  // not wait on the scroll, so a cancelled animation can no longer eat the tap.
  const focus = (id: string) => {
    // The selection is committed first and on its own. Anything that reaches the
    // Telegram client - haptics above all - can be rejected on an older one, and
    // must never sit between the tap and the state it is supposed to produce.
    onSelect(id === NONE ? '' : id)
    lastPicked.current = id
    try { haptics.impact('light') } catch { /* a client that refuses haptics still gets the tap */ }
    centreOn(id, true)
  }

  const categoryType = categories[0]?.type
  const centred = useRef(false)
  // Measure as soon as the tiles are committed, so a drag that happens before the
  // opening centring animation still has positions to match against.
  useEffect(() => { remeasure() }, [categoryType, remeasure])
  useEffect(() => {
    const centre = () => {
      // Positions must be read after this render committed the new tiles, or the
      // strip would still be matched against the previous type's layout.
      remeasure()
      lastPicked.current = selectedRef.current || NONE
      centreOn(lastPicked.current, false)
    }
    // A timer rather than a frame: swapping income/expense while the app is in the
    // background must still leave the strip centred, and frames do not run there.
    const timer = window.setTimeout(centre, centred.current ? 0 : prefersReducedMotion() ? 0 : 460)
    centred.current = true
    return () => window.clearTimeout(timer)
  // Re-centre when income/expense swaps the category dataset.
  }, [categoryType, remeasure])

  const selected = categories.find((item) => item.id === selectedId)
  return <div className="category-carousel">
    <div className="category-strip" ref={strip} onPointerDown={releaseToGesture}>
      <button
        type="button"
        data-id={NONE}
        className={`category-none${selectedId ? '' : ' selected'}`}
        aria-label="Без категории"
        onClick={() => focus(NONE)}
      ><CircleSlash2 /></button>
      {categories.map((item) => <button
        type="button"
        key={item.id}
        data-id={item.id}
        className={item.id === selectedId ? 'selected' : ''}
        style={tileStyle(item.color)}
        aria-label={item.name}
        onClick={() => focus(item.id)}
      ><CategoryGlyph icon={item.icon} /></button>)}
    </div>
    <strong style={{ color: selected?.color || 'var(--muted)' }}>{selected?.name || 'Без категории'}</strong>
  </div>
}


/** Insight tile: title and icon on top, a grey explanation, the value bottom-right. */
function InsightTile({ title, icon, note, value, tone, sign, children }: {
  title: string
  icon?: ReactNode
  note?: string
  value: string
  tone?: 'warm' | 'green' | 'muted'
  /** Money tiles tint by direction: what leaves reads warm, what arrives reads lime. */
  sign?: 'in' | 'out'
  children?: ReactNode
}) {
  const stacked = Boolean(children)
  return <article className={[
    sign === 'out' ? 'sign-out' : '', sign === 'in' ? 'sign-in' : '',tone === 'warm' ? 'warm' : '', tone === 'green' ? 'lime' : '', stacked ? 'stacked' : ''].filter(Boolean).join(' ') || undefined}>
    <h3>{title}{icon}</h3>
    {children}
    {note && <small>{note}</small>}
    <strong className={tone === 'green' ? 'green' : tone === 'warm' ? 'warm' : tone === 'muted' ? 'muted' : undefined}>{value}</strong>
  </article>
}


function Card({ title, children }: { title: string; children: ReactNode }) { return <section className="content-card"><h2>{title}</h2>{children}</section> }
function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function InlineForm({ onSubmit, children }: { onSubmit(event: FormEvent): void; children: ReactNode }) { return <form className="inline-form" onSubmit={onSubmit}>{children}</form> }
function Submit({ pending, children }: { pending: boolean; children: ReactNode }) { return <button className="primary-button wide" disabled={pending}>{pending ? <LoaderCircle className="spin" /> : children}</button> }
function ToastNotice({ toast, onDismiss }: {
  toast: { text: string; action?: string; onAction?: () => void }
  onDismiss(): void
}) {
  const [closing, setClosing] = useState(false)
  const dismiss = useRef(onDismiss)
  useEffect(() => { dismiss.current = onDismiss }, [onDismiss])
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const leave = window.setTimeout(() => setClosing(true), reduced ? 4380 : 4340)
    const remove = window.setTimeout(() => dismiss.current(), 4500)
    return () => { window.clearTimeout(leave); window.clearTimeout(remove) }
  }, [])
  return <div className={`toast${closing ? ' closing' : ''}`} role="status">
    {toast.action && <svg className="toast-countdown" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="track" cx="8" cy="8" r="7" />
      <circle className="run" cx="8" cy="8" r="7" />
    </svg>}
    <span>{toast.text}</span>
    {toast.action && <button type="button" onClick={toast.onAction}>{toast.action}</button>}
  </div>
}
function Loading() {
  // Telegram shows its own placeholder until the app calls ready(); this only
  // covers the gap while the first snapshot request is in flight.
  return <main className="app-shell state-screen"><LoaderCircle className="spin" /></main>
}

function AuthError({ error, retry }: { error: unknown; retry(): void }) { const message = error instanceof ApiError ? error.message : 'Не удалось открыть приложение'; return <main className="app-shell state-screen"><div className="logo-mark error"><BriefcaseBusiness /></div><h1>Не получилось войти</h1><p>{message}</p><button className="primary-button" onClick={retry}>Попробовать снова</button></main> }
