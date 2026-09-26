/**
 * Switching modes replaces the open editor. Hand the new one the caret's
 * screen position so it lands in the same place and nothing scrolls.
 */
export function keepCaretAcrossSwitch(): void {
  const note = document.activeElement?.closest('[data-editor=note]');
  const id = note?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (!note || !id) return;
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  const rect = note instanceof HTMLTextAreaElement ? note.getBoundingClientRect() : range?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  caretHandoff = { id, x: rect.left + 1, y: rect.top + rect.height / 2 };
}

/** Where the next note editor should put its caret, set just before a mode switch. */
let caretHandoff: { id: string; x: number; y: number } | null = null;
export function takeCaretHandoff(id: string): { x: number; y: number } | null {
  const h = caretHandoff;
  caretHandoff = null;
  return h && h.id === id ? h : null;
}
