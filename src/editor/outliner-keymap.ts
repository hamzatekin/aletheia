import { Extension } from '@tiptap/core';

/** Structural keys the editor never handles itself; they go to the outline. */
export type OutlineKey =
  | 'enter'
  | 'note'
  | 'indent'
  | 'outdent'
  | 'backspaceAtStart'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'collapse'
  | 'expand'
  | 'moveUp'
  | 'moveDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'escape'
  | 'undo'
  | 'redo';

export interface OutlinerKeymapStorage {
  /** Set by the outline; returns true when the key was consumed. */
  handler: ((key: OutlineKey) => boolean) | null;
}

export const OutlinerKeymap = Extension.create<Record<string, never>, OutlinerKeymapStorage>({
  name: 'outlinerKeymap',
  priority: 1000,

  addStorage() {
    return { handler: null };
  },

  addKeyboardShortcuts() {
    const send = (key: OutlineKey) => () => this.storage.handler?.(key) ?? false;
    const { editor } = this;
    const atStart = () => editor.state.selection.empty && editor.state.selection.from <= 1;
    const atEnd = () => editor.state.selection.empty && editor.state.selection.to >= editor.state.doc.content.size - 1;
    return {
      Enter: send('enter'),
      'Shift-Enter': send('note'),
      'Mod-Enter': send('enter'),
      Tab: send('indent'),
      'Shift-Tab': send('outdent'),
      Backspace: () => (atStart() ? send('backspaceAtStart')() : false),
      ArrowUp: () => (editor.view.endOfTextblock('up') ? send('up')() : false),
      ArrowDown: () => (editor.view.endOfTextblock('down') ? send('down')() : false),
      ArrowLeft: () => (atStart() ? send('left')() : false),
      ArrowRight: () => (atEnd() ? send('right')() : false),
      'Mod-ArrowUp': send('collapse'),
      'Mod-ArrowDown': send('expand'),
      'Alt-Shift-ArrowUp': send('moveUp'),
      'Alt-Shift-ArrowDown': send('moveDown'),
      'Mod-.': send('zoomIn'),
      'Mod-,': send('zoomOut'),
      Escape: send('escape'),
      // ProseMirror swallows Mod-z/y itself (to block native undo), so the
      // outline must receive them here rather than on window.
      'Mod-z': send('undo'),
      'Shift-Mod-z': send('redo'),
      'Mod-y': send('redo'),
    };
  },
});
