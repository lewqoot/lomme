import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowDownLeft, Check, ChevronLeft,
  ChevronRight, CircleSlash2, Copy, LoaderCircle, Zap, Download,
  LayoutGrid, Mail, Settings2, Users,
} from 'lucide-react'
import { api, ApiError, haptic } from '../../lib/api'
import { copyText } from '../../lib/telegram'

type SettingsScreen = 'root' | 'automations'
type SettingsMotion = 'idle' | 'enter' | 'return'
const SETTINGS_NAVIGATION_DURATION_MS = 240
type Props = {
  backRef: { current: (() => void) | null }
  notify(text: string): void
  onNavigate(page: 'categories' | 'family'): void
  onClose(): void
}

export function SettingsPage({ backRef, notify, onNavigate, onClose }: Props) {
  const [screen, setScreen] = useState<SettingsScreen>('root')
  const [screenMotion, setScreenMotion] = useState<SettingsMotion>('idle')
  const screenTimer = useRef<number | null>(null)

  const move = useCallback((next: SettingsScreen, motion: Exclude<SettingsMotion, 'idle'>) => {
    if (screenTimer.current) window.clearTimeout(screenTimer.current)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setScreen(next)
    setScreenMotion(motion)
    window.scrollTo({ top: 0, behavior: 'auto' })
    screenTimer.current = window.setTimeout(() => {
      setScreenMotion('idle')
      screenTimer.current = null
    }, reduced ? 120 : SETTINGS_NAVIGATION_DURATION_MS)
  }, [])
  const open = (next: SettingsScreen) => { haptic(); move(next, 'enter') }
  const back = useCallback(() => {
    move('root', 'return')
  }, [move])

  useEffect(() => () => {
    if (screenTimer.current) window.clearTimeout(screenTimer.current)
  }, [])

  useEffect(() => {
    backRef.current = screen === 'root' ? null : back
    return () => { backRef.current = null }
  }, [back, backRef, screen])

  if (screen === 'automations') return <AutomationsScreen motion={screenMotion === 'enter' ? ' motion-enter-push' : ''} onBack={back} notify={notify} />

  return <div className={`settings-screen${screenMotion === 'return' ? ' motion-return-push' : ''}`}>
    <SettingsHeader title="Настройки" onBack={onClose} />

    <SettingsSection title="Основные">
      <SettingsRow icon={<LayoutGrid />} label="Категории" onClick={() => onNavigate('categories')} />
    </SettingsSection>

    <SettingsSection title="Дополнительно">
      <SettingsRow icon={<Zap />} label="Быстрый ввод" value="Шорткат" onClick={() => open('automations')} />
      <SettingsRow icon={<Users />} label="Семейный кошелёк" onClick={() => onNavigate('family')} />
    </SettingsSection>

    <SettingsSection title="Поддержка">
      <SettingsRow icon={<Mail />} label="Помощь и поддержка" muted />
    </SettingsSection>
  </div>
}

function SettingsHeader({ title, onBack }: { title: string; onBack(): void }) {
  return <header className="centered-overlay-header settings-page-header"><button type="button" className="close-orb" onClick={onBack} aria-label="Назад"><ChevronLeft /></button><h1>{title}</h1><span /></header>
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return <><span className="settings-label">{title}</span><section className="settings-group">{children}</section></>
}

function SettingsRow({ icon, label, value, onClick, muted }: {
  icon: ReactNode; label: string; value?: string; onClick?: () => void
  /** Section exists but is not finished: shown, greyed, and not interactive. */
  muted?: boolean
}) {
  const content = <><span className="settings-row-icon">{icon}</span><strong>{label}</strong><em>{value}{onClick && !muted && <ChevronRight />}</em></>
  if (muted) return <div className="settings-row settings-row-static settings-row-muted" aria-disabled="true">{content}</div>
  return onClick
    ? <button className="settings-row" type="button" onClick={onClick}>{content}</button>
    : <div className="settings-row settings-row-static">{content}</div>
}

type ShortcutSheet = 'backTap' | 'actionButton' | 'homeWidget' | 'controlCenter' | 'reissue'

const SHORTCUT_GUIDES: Record<Exclude<ShortcutSheet, 'reissue'>, { title: string; note?: string; steps: string[] }> = {
  backTap: {
    title: 'Запуск двойным касанием',
    steps: ['Открой «Настройки» → «Универсальный доступ» → «Касание».', 'Нажми «Касание задней панели» → «Двойное касание».', 'Выбери «Lomme — записать трату».'],
  },
  actionButton: {
    title: 'Запуск кнопкой действия',
    note: 'Доступно на iPhone 15 Pro и новее.',
    steps: ['Открой «Настройки» → «Кнопка действия».', 'Смахни до пункта «Быстрая команда».', 'Нажми «Выбрать команду» → «Lomme — записать трату».'],
  },
  homeWidget: {
    title: 'Запуск с экрана «Домой»',
    steps: ['Зажми фон экрана «Домой» → «Изменить» → «Добавить виджет».', 'Найди «Быстрые команды» и добавь маленький виджет.', 'Зажми виджет → «Изменить виджет» → выбери «Lomme — записать трату».'],
  },
  controlCenter: {
    title: 'Запуск из Пункта управления',
    note: 'Доступно на iOS 18 и новее.',
    steps: ['Открой Пункт управления и нажми «Добавить» в левом верхнем углу.', 'Нажми «Добавить элемент управления».', 'Выбери «Быстрая команда» → «Выбрать» → «Lomme — записать трату».'],
  },
}

function ShortcutGuideSheet({ sheet, onClose, onReissue, pending }: { sheet: ShortcutSheet | null; onClose(): void; onReissue(): void; pending: boolean }) {
  if (!sheet) return null
  const reissue = sheet === 'reissue'
  const guide = reissue ? null : SHORTCUT_GUIDES[sheet]
  return createPortal(<div className="shortcut-guide-scrim" role="presentation" onMouseDown={onClose}>
    <section className="shortcut-guide-sheet" role="dialog" aria-modal="true" aria-labelledby="shortcut-sheet-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="shortcut-guide-close" type="button" onClick={onClose} aria-label="Закрыть"><ChevronLeft /></button>
      <div className="shortcut-guide-media"><Zap /></div>
      <h2 id="shortcut-sheet-title">{reissue ? 'Настроить заново?' : guide!.title}</h2>
      {reissue
        ? <><p>Старая команда перестанет работать. Новый ключ нужно будет вставить ещё раз.</p><div className="shortcut-sheet-actions"><button type="button" onClick={onClose}>Отмена</button><button type="button" className="primary" disabled={pending} onClick={onReissue}>{pending ? <LoaderCircle className="spin" /> : 'Создать новый ключ'}</button></div></>
        : <>{guide!.note && <p className="shortcut-binding-unavailable">{guide!.note}</p>}<ol className="shortcut-guide-steps">{guide!.steps.map((step) => <li key={step}>{step}</li>)}</ol><button className="shortcut-stage-primary" type="button" onClick={onClose}>Готово</button></>}
    </section>
  </div>, document.body)
}

function AutomationsScreen({ motion, onBack, notify }: { motion: string; onBack(): void; notify(text: string): void }) {
  const [key, setKey] = useState('')
  const [hasActiveKey, setHasActiveKey] = useState(false)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [statusFailed, setStatusFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<ShortcutSheet | null>(null)

  const loadStatus = useCallback(() => {
    let cancelled = false
    void api<{ active: boolean }>('/quick-key/status')
      .then((result) => { if (!cancelled) setHasActiveKey(result.active) })
      .catch(() => { if (!cancelled) setStatusFailed(true) })
      .finally(() => { if (!cancelled) setStatusLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => loadStatus(), [loadStatus])

  const issue = useMutation({
    mutationFn: (replace: boolean) => api<{ key: string }>('/quick-key', { method: 'POST', body: JSON.stringify({ replace }) }),
    onSuccess: (result) => {
      setKey(result.key); setHasActiveKey(true); setStatusLoaded(true); setCopied(false); setError(''); setSheet(null); haptic('success')
      void copyText(result.key).then((success) => {
        setCopied(success)
        if (success) {
          notify('Ключ создан и скопирован')
        } else {
          setError('Ключ создан, но iPhone не разрешил скопировать его. Нажми «Скопировать ключ».')
        }
      })
    },
    onError: (cause) => {
      if (cause instanceof ApiError && cause.code === 'QUICK_KEY_EXISTS') {
        setHasActiveKey(true)
        setError('')
        return
      }
      setError(cause instanceof Error ? cause.message : 'Не удалось создать ключ. Попробуй ещё раз.')
    },
  })

  const copy = async () => {
    const success = Boolean(key) && await copyText(key)
    if (!success) { setError('Не получилось скопировать. Попробуй ещё раз в приложении Telegram.'); return }
    setCopied(true)
    haptic('success')
    notify('Ключ скопирован')
  }
  const beginIssue = () => { if (hasActiveKey) setSheet('reissue'); else issue.mutate(false) }
  const retryStatus = () => { setStatusLoaded(false); setStatusFailed(false); setError(''); loadStatus() }

  const bindings: Array<{ id: Exclude<ShortcutSheet, 'reissue'>; title: string; detail: string; icon: ReactNode }> = [
    { id: 'backTap', title: 'Двойное касание', detail: 'Постучи по задней панели iPhone', icon: <ArrowDownLeft /> },
    { id: 'actionButton', title: 'Кнопка действия', detail: 'Запуск одним нажатием', icon: <Zap /> },
    { id: 'homeWidget', title: 'Экран «Домой»', detail: 'Запуск через виджет', icon: <LayoutGrid /> },
    { id: 'controlCenter', title: 'Пункт управления', detail: 'Доступ с любого экрана', icon: <Settings2 /> },
  ]

  const bindingStage = <section className="shortcut-stage shortcut-stage-bindings">
    <div className="shortcut-stage-head"><span className="shortcut-stage-number">2</span><div><strong>Выбери способ запуска</strong><p>Достаточно настроить один.</p></div></div>
    <div className="shortcut-binding-list">{bindings.map((item) => <button className="shortcut-binding-row" type="button" key={item.id} onClick={() => setSheet(item.id)}><span className="shortcut-binding-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight /></button>)}</div>
  </section>

  return <div className={`settings-subscreen automations-screen${motion}`}>
    <SettingsHeader title="Быстрый ввод" onBack={onBack} />
    <p className="shortcut-intro">Сначала добавь команду Lomme, затем выбери быстрый вызов.</p>

    {!statusLoaded
      ? <section className="shortcut-stage shortcut-stage-pending"><LoaderCircle className="spin" /><p>Проверяем настройку…</p></section>
      : statusFailed
        ? <section className="shortcut-stage">
          <div className="shortcut-stage-head"><span className="shortcut-stage-number"><CircleSlash2 /></span><div><strong>Не удалось проверить настройку</strong><p>Проверь интернет и попробуй ещё раз.</p></div></div>
          <button className="shortcut-stage-primary" type="button" onClick={retryStatus}>Попробовать ещё раз</button>
        </section>
        : !key && !hasActiveKey
        ? <section className="shortcut-stage">
          <div className="shortcut-stage-head"><span className="shortcut-stage-number">1</span><div><strong>Создай команду</strong><p>Личный ключ нужен только для записи трат.</p></div></div>
          <button className="shortcut-stage-primary" type="button" disabled={issue.isPending} onClick={beginIssue}>{issue.isPending ? <LoaderCircle className="spin" /> : <Copy />}Создать и скопировать ключ</button>
          <div className="shortcut-stage-locked"><span className="shortcut-stage-number">2</span><div><strong>Выбери способ запуска</strong><p>После добавления команды.</p></div></div>
        </section>
        : !key
          ? <>
            <section className="shortcut-stage shortcut-stage-complete">
              <div className="shortcut-stage-head"><span className="shortcut-stage-number"><Check /></span><div><strong>Команда уже настроена</strong><p>Если быстрый ввод работает, ключ менять не нужно.</p></div></div>
              <button className="shortcut-stage-reset" type="button" onClick={() => setSheet('reissue')}>Настроить заново</button>
            </section>
            {bindingStage}
          </>
          : <>
          <section className="shortcut-stage">
            <div className="shortcut-stage-head"><span className="shortcut-stage-number">1</span><div><strong>Добавь команду Lomme</strong><p>{copied ? 'Ключ скопирован. Вставь его при добавлении команды.' : 'Скопируй ключ и вставь его при добавлении команды.'}</p></div></div>
            {!copied && <button className="shortcut-stage-copy" type="button" onClick={() => void copy()}><Copy />Скопировать ключ</button>}
            {copied && <div className="shortcut-stage-status"><Check />Ключ скопирован</div>}
            {copied
              ? <a className="shortcut-stage-primary" href="/shortcut/install"><Download />Открыть в «Командах»</a>
              : <button className="shortcut-stage-primary" type="button" disabled><Download />Открыть в «Командах»</button>}
            <p className="shortcut-stage-hint">Откроется готовая команда Apple. Нажми «Добавить команду» и вставь скопированный ключ.</p>
          </section>
          {bindingStage}
        </>}
    {error && <p className="form-error">{error}</p>}
    <ShortcutGuideSheet sheet={sheet} onClose={() => setSheet(null)} pending={issue.isPending} onReissue={() => issue.mutate(true)} />
  </div>
}
