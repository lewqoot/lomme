import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react'
import type { AppSnapshot, CategoryView } from '../../shared/contracts'
import { FALLBACK_ICON, ICON_GROUPS, ICON_IDS } from '../../config/icons'
import { ensureIconLibrary } from '../../lib/icon-library'
import { api, haptic } from '../../lib/api'
import { tint } from '../../lib/palette'
import { ordered } from './ordering'
import { CATEGORY_PICKER_COLORS as COLORS, DATA_COLORS } from '../../shared/design-tokens'

type CategoryType = CategoryView['type']

type Props = {
  data: AppSnapshot
  onRefresh(): void
  notify(text: string): void
  onClose(): void
}

const tileStyle = (color?: string): CSSProperties => ({ background: tint(color), color: color || DATA_COLORS.glyphFallback })

function Glyph({ icon }: { icon?: string }) {
  return <svg className="glyph" aria-hidden="true"><use href={`#i-${icon && ICON_IDS.includes(icon) ? icon : FALLBACK_ICON}`} /></svg>
}


export function CategoriesPage({ data, onRefresh, notify, onClose }: Props) {
  const [type, setType] = useState<CategoryType>('expense')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<CategoryView | 'new' | null>(null)
  const [editorClosing, setEditorClosing] = useState(false)
  const editorTimer = useRef<number | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const dragStartRef = useRef<{ id: string; x: number; y: number; pointerId: number; target: HTMLElement } | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const justDraggedRef = useRef(false)
  const sourceKey = data.categories.map((item) => `${item.id}:${item.type}:${item.order}:${item.version}:${item.archivedAt}`).join('|')
  const sourceIds = ordered(data.categories, type).map((item) => item.id)
  const [localOrder, setLocalOrder] = useState<{ type: CategoryType; sourceKey: string; ids: string[] } | null>(null)
  const orderIds = localOrder?.type === type && localOrder.sourceKey === sourceKey ? localOrder.ids : sourceIds
  const setOrder = (ids: string[]) => setLocalOrder({ type, sourceKey, ids })

  const categories = useMemo(() => {
    const byId = new Map(data.categories.map((item) => [item.id, item]))
    return orderIds.map((id) => byId.get(id)).filter((item): item is CategoryView => Boolean(item))
  }, [data.categories, orderIds])
  const visible = query.trim()
    ? categories.filter((item) => item.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    : categories

  const reorder = useMutation({
    mutationFn: (categoryIds: string[]) => api('/categories/reorder', { method: 'PUT', body: JSON.stringify({ workspaceId: data.activeWorkspaceId, type, categoryIds }) }),
    onSuccess: () => { onRefresh(); haptic('success') },
    onError: () => {
      const next = ordered(data.categories, type).map((item) => item.id)
      setOrder(next)
      notify('Не удалось сохранить порядок')
    },
  })

  const moveBefore = (id: string, targetId: string) => {
    const current = orderIds
    const from = current.indexOf(id); const to = current.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    const next = current.slice(); next.splice(from, 1); next.splice(to, 0, id)
    setOrder(next)
  }
  const moveBy = (id: string, offset: number) => {
    const current = orderIds
    const from = current.indexOf(id); const to = Math.max(0, Math.min(current.length - 1, from + offset))
    if (from < 0 || from === to) return
    const next = current.slice(); next.splice(from, 1); next.splice(to, 0, id)
    setOrder(next); reorder.mutate(next)
  }
  const LONG_PRESS_MS = 260
  const MOVE_CANCEL_PX = 8
  const clearLongPress = () => {
    if (longPressTimer.current) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }
  const beginRowPress = (event: PointerEvent<HTMLElement>, id: string) => {
    if (query.trim()) return
    justDraggedRef.current = false
    dragStartRef.current = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, target: event.currentTarget }
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => {
      const start = dragStartRef.current
      if (!start) return
      justDraggedRef.current = true
      try { start.target.setPointerCapture(start.pointerId) } catch { /* pointer no longer active */ }
      setDragging(start.id); haptic('medium')
    }, LONG_PRESS_MS)
  }
  const moveRowPress = (event: PointerEvent<HTMLElement>) => {
    if (dragging) {
      event.preventDefault()
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-category-row]')
      const targetId = row?.dataset.categoryRow
      if (targetId && targetId !== dragging) moveBefore(dragging, targetId)
      return
    }
    const start = dragStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_CANCEL_PX) {
      clearLongPress(); dragStartRef.current = null
    }
  }
  const endRowPress = (event: PointerEvent<HTMLElement>) => {
    clearLongPress(); dragStartRef.current = null
    if (!dragging) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(null); reorder.mutate(orderIds)
  }
  const openIfNotDragged = (item: CategoryView) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return }
    setEditor(item)
  }
  const keyMove = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault(); moveBy(id, event.key === 'ArrowUp' ? -1 : 1)
  }

  useEffect(() => () => {
    if (editorTimer.current) window.clearTimeout(editorTimer.current)
  }, [])
  const closeEditor = () => {
    if (editorClosing) return
    setEditorClosing(true)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    editorTimer.current = window.setTimeout(() => {
      setEditor(null)
      setEditorClosing(false)
      editorTimer.current = null
    }, reduced ? 120 : 360)
  }

  if (editor) return <CategoryEditor
    data={data}
    initial={editor === 'new' ? null : editor}
    initialType={type}
    closing={editorClosing}
    onClose={closeEditor}
    onSaved={() => { onRefresh(); closeEditor() }}
    notify={notify}
  />

  return <div className="categories-screen">
    <header className="categories-header">
      <button type="button" className="close-orb" aria-label="Назад" onClick={onClose}><ChevronLeft /></button>
      <TypeSwitch type={type} onChange={(next) => { setType(next); setQuery(''); haptic() }} />
      <button type="button" className="action-orb" aria-label="Новая категория" onClick={() => setEditor('new')}><Plus /></button>
    </header>
    <label className="category-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label>
    <div className={`category-manage-list${dragging ? ' dragging' : ''}`}>
      {visible.map((item) => <article
        className={`category-manage-row${item.id === dragging ? ' is-dragging' : ''}${item.parentId ? ' child' : ''}`}
        key={item.id}
        data-category-row={item.id}
        onPointerDown={(event) => beginRowPress(event, item.id)}
        onPointerMove={moveRowPress}
        onPointerUp={endRowPress}
        onPointerCancel={endRowPress}
      >
        <button
          type="button"
          className={`category-row-open${item.parentId ? ' has-parent' : ''}`}
          aria-label={item.name}
          onClick={() => openIfNotDragged(item)}
          onKeyDown={(event) => keyMove(event, item.id)}
        >
          <span className="category-manage-icon" style={tileStyle(item.color)}><Glyph icon={item.icon} /></span>
          <strong>{item.name}</strong>
          {item.parentId && <small>{data.categories.find((parent) => parent.id === item.parentId)?.name}</small>}
          <ChevronRight className="category-row-chevron" />
        </button>
      </article>)}
      {!visible.length && <div className="category-search-empty">Категории не найдены</div>}
    </div>
  </div>
}

function TypeSwitch({ type, onChange }: { type: CategoryType; onChange(type: CategoryType): void }) {
  return <div className={`category-type-switch ${type}`}>
    <button type="button" className={type === 'income' ? 'active' : ''} aria-label="Доход" onClick={() => onChange('income')}><ArrowDownLeft /><span>Доход</span></button>
    <button type="button" className={type === 'expense' ? 'active' : ''} aria-label="Расход" onClick={() => onChange('expense')}><ArrowUpRight /><span>Расход</span></button>
  </div>
}

function CategoryEditor({ data, initial, initialType, closing, onClose, onSaved, notify }: {
  data: AppSnapshot
  initial: CategoryView | null
  initialType: CategoryType
  closing: boolean
  onClose(): void
  onSaved(): void
  notify(text: string): void
}) {
  const [type, setType] = useState<CategoryType>(initial?.type || initialType)
  const [name, setName] = useState(initial?.name || '')
  const [icon, setIcon] = useState(initial?.icon || FALLBACK_ICON)
  const [color, setColor] = useState(initial?.color || DATA_COLORS.categoryEditorDefault)
  const [parentId, setParentId] = useState(initial?.parentId || '')
  const [error, setError] = useState('')
  const parents = ordered(data.categories, type).filter((item) => item.id !== initial?.id && !item.parentId)

  const save = useMutation({
    mutationFn: () => initial
      ? api(`/categories/${initial.id}`, { method: 'PUT', body: JSON.stringify({ type, name, icon, color, parentId: parentId || null, version: initial.version }) })
      : api('/categories', { method: 'POST', body: JSON.stringify({ workspaceId: data.activeWorkspaceId, type, name, icon, color, parentId: parentId || null }) }),
    onSuccess: () => { haptic('success'); notify(initial ? 'Категория обновлена' : 'Категория создана'); onSaved() },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Не удалось сохранить категорию'),
  })
  const archive = useMutation({
    mutationFn: () => api(`/categories/${initial!.id}?version=${initial!.version}`, { method: 'DELETE' }),
    onSuccess: () => { haptic('success'); notify('Категория удалена'); onSaved() },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Не удалось удалить категорию'),
  })
  const nameField = useRef<HTMLInputElement>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Введите название категории')
      nameField.current?.focus()
      haptic()
      return
    }
    setError('')
    save.mutate()
  }

  return <form className={`category-editor-sheet${closing ? ' motion-exit-sheet' : ''}`} onSubmit={submit}>
    <header className="centered-overlay-header"><button type="button" className="close-orb" aria-label="Назад" onClick={onClose}><ChevronLeft /></button><h1>{initial ? 'Категория' : 'Новая категория'}</h1><span /></header>
    <div className="category-editor-main">
      <label className="category-parent-select">
        <Plus /><span>{parentId ? data.categories.find((item) => item.id === parentId)?.name : 'Родительская категория'}</span>
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Без родительской категории</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </label>
      <label className="category-name-field"><span style={tileStyle(color)}><Glyph icon={icon} /></span><input ref={nameField} autoFocus value={name} maxLength={80} onChange={(event) => { setName(event.target.value); if (error) setError('') }} placeholder="Название" aria-invalid={Boolean(error) || undefined} /></label>
      <TypeSwitch type={type} onChange={(next) => { setType(next); setParentId(''); haptic() }} />
    </div>
    <div className="category-editor-tools">
      <div className="category-color-picker">{COLORS.map((item) => <button type="button" key={item} className={item === color ? 'selected' : ''} style={{ background: item }} aria-label={`Цвет ${item}`} onClick={() => { setColor(item); haptic() }} />)}</div>
      <IconPicker value={icon} color={color} onPick={(next) => { setIcon(next); haptic() }} />
    </div>
    {error && <p className="form-error category-editor-error">{error}</p>}
    <div className="category-editor-actions">
      {initial && <button type="button" className="category-delete" aria-label="Удалить категорию" disabled={archive.isPending} onClick={() => archive.mutate()}><Trash2 /></button>}
      <button type="submit" className="category-save" disabled={save.isPending || archive.isPending}>{save.isPending ? <LoaderCircle className="spin" /> : 'Сохранить'}</button>
    </div>
  </form>
}

function IconPicker({ value, color, onPick }: { value: string; color: string; onPick(icon: string): void }) {
  // The picker lists every group at once, so the rest of the sprite comes with it.
  const [, redraw] = useState(0)
  useEffect(() => { void ensureIconLibrary().then(() => redraw((value) => value + 1)) }, [])
  return <div className="category-icon-pager">{ICON_GROUPS.map((group) => <section key={group.label}>
    <h4>{group.label}</h4>
    <div>{group.icons.map((icon) => <button
      type="button"
      key={icon}
      className={icon === value ? 'selected' : ''}
      style={icon === value ? tileStyle(color) : undefined}
      aria-label={icon}
      aria-pressed={icon === value}
      onClick={() => onPick(icon)}
    ><Glyph icon={icon} /></button>)}</div>
  </section>)}</div>
}
