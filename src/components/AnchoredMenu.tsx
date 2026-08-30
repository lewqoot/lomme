import type { ReactNode } from 'react'

/** One row of the popover: leading check slot, then the label. */
export function MenuItem({ checked, onSelect, children }: { checked: boolean; onSelect(): void; children: ReactNode }) {
  return <button type="button" role="menuitemradio" aria-checked={checked} onClick={onSelect}>
    <i aria-hidden="true">{checked && <CheckGlyph />}</i>
    {children}
  </button>
}

function CheckGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
}
