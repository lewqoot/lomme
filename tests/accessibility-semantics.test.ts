import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expenseCategories, incomeCategories } from '../src/shared/default-categories.js'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const iconMigration = readFileSync(new URL('../drizzle/0008_other_category_icon.sql', import.meta.url), 'utf8')

describe('touch targets and semantics', () => {
  it('keeps primary compact controls on a 44px hit target', () => {
    expect(css).toContain('--touch-target: 44px')
    expect(css).toMatch(/\.header-actions button\s*\{[^}]*width:\s*var\(--touch-target\)[^}]*height:\s*var\(--touch-target\)/s)
    expect(css).toMatch(/\.period-pill > button\s*\{[^}]*width:\s*var\(--touch-target\)[^}]*height:\s*var\(--touch-target\)/s)
    expect(css).toMatch(/\.icon-button::before\s*\{[^}]*width:\s*var\(--touch-target\)[^}]*height:\s*var\(--touch-target\)/s)
    expect(app).toContain('aria-label="Поиск"')
    expect(app).toContain('aria-label="Аналитика"')
    expect(app).toContain('aria-label="Настройки"')
  })

  it('uses separate symbols for uncategorized operations and the Other category', () => {
    const otherIcons = [...expenseCategories, ...incomeCategories]
      .filter(([name]) => name === 'Прочее')
      .map(([, icon]) => icon)
    expect(otherIcons).toEqual(['shapes', 'shapes'])
    expect(otherIcons).not.toContain('circle-slash-2')
    expect(app).toMatch(/aria-label="Без категории"[\s\S]*?<CircleSlash2 \/>/)
    expect(iconMigration).toContain(`SET "icon" = 'shapes'`)
    expect(iconMigration).toContain(`AND "icon" = 'circle-slash-2'`)
  })

  it('anchors category names to the left edge', () => {
    expect(css).toMatch(/\.category-row-open > strong\s*\{\s*text-align:\s*left;/)
    expect(css).not.toMatch(/\.category-row-open > strong\s*\{\s*text-align:\s*center;/)
  })
})
