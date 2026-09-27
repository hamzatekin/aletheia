import { useEffect } from 'react';
import type { EditorSession } from '@/editor/session';
import { CLIP_TYPE } from '@/io/clipboard';
import type { SettingsStore } from '@/store/settings-store';
import type { UiStore } from '@/store/ui-store';
import type { OutlineActions } from './actions';

/**
 * Window- and document-level listeners the outline page needs: the editor's
 * key and paste handlers, page shortcuts, clipboard on selected nodes, and
 * drag-to-select across rows.
 */
export function usePageEvents(actions: OutlineActions, session: EditorSession, ui: UiStore, settings: SettingsStore): void {
  useEditorHandlers(actions, session);
  usePageShortcuts(actions, session, ui, settings);
  useSelectionClipboard(actions);
  useDragSelect(actions, ui);
}

function useEditorHandlers(actions: OutlineActions, session: EditorSession): void {
  useEffect(() => {
    session.setKeyHandler(actions.handleKey);
    session.pasteHandler = actions.pasteLines;
    const off = session.onTransaction(actions.syncSlash);
    return () => {
      session.setKeyHandler(null);
      session.pasteHandler = null;
      off();
    };
  }, [session, actions]);
}

function usePageShortcuts(actions: OutlineActions, session: EditorSession, ui: UiStore, settings: SettingsStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        const s = settings.getState();
        s.update({ sidebarOpen: !s.sidebarOpen });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        session.flush();
        ui.blur();
        ui.setHelpOpen(!ui.getState().helpOpen);
        return;
      }
      actions.handleGlobalKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, settings, session, ui]);
}

/** Ctrl+C / Ctrl+X / Ctrl+V on selected nodes. Nothing is focused then, so the events land on the page. */
function useSelectionClipboard(actions: OutlineActions): void {
  useEffect(() => {
    const inField = (e: Event) => (e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]') != null;
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (inField(e) || !e.clipboardData) return;
      if (actions.copySelection(e.clipboardData, cut)) e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e) || !e.clipboardData) return;
      if (actions.pasteIntoSelection(e.clipboardData.getData('text/plain'), e.clipboardData.getData(CLIP_TYPE) || null)) e.preventDefault();
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPaste);
    };
  }, [actions]);
}

/** Dragging with the mouse from one row into others selects whole rows, as in WorkFlowy. */
function useDragSelect(actions: OutlineActions, ui: UiStore): void {
  useEffect(() => {
    let start: string | null = null;
    let active = false;
    const rowAt = (x: number, y: number): string | null => {
      const row = document.elementFromPoint(x, y)?.closest('[data-node-id]:not([data-title])');
      return row instanceof HTMLElement ? (row.dataset.nodeId ?? null) : null;
    };
    const onDown = (e: MouseEvent) => {
      start = null;
      active = false;
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as Element;
      if (!t.closest?.('.row-text') || t.closest('a, button')) return;
      start = rowAt(e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent) => {
      if (start === null) return;
      if ((e.buttons & 1) === 0) {
        start = null;
        return;
      }
      const over = rowAt(e.clientX, e.clientY);
      if (over === null || (!active && over === start)) return;
      active = true;
      document.getSelection()?.removeAllRanges();
      const sel = ui.getState().selection;
      if (sel?.anchor !== start || sel.head !== over || ui.getState().focus) actions.selectRange(start, over);
    };
    const onUp = () => {
      start = null;
      active = false;
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [actions, ui]);
}
