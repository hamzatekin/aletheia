import { useEffect, useRef } from 'react';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { markdownOptions } from './markdown';

const SAVE_DELAY_MS = 400;

function markdownOf(editor: Editor): string {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown().replace(/\s+$/, '');
}

/**
 * Notes edited as rendered Markdown: headings, lists, quotes, code blocks and
 * inline marks show as you type (Markdown shortcuts like "## " or "```" work),
 * and the note is saved back as Markdown.
 */
export function RichNoteEditor({ id }: { id: string }) {
  const { engine, ui, actions } = useOutline();
  const node = useNode(id);
  const stored = node?.note ?? '';
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  /** Note text last synchronised with the store. */
  const known = useRef(stored);
  /**
   * The editor's own serialization of `known`: loading normalises some
   * Markdown (list markers, spacing), and that alone must not count as an edit.
   */
  const loaded = useRef('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const md = markdownOf(editor);
      if (md === loaded.current) return;
      loaded.current = md;
      known.current = md;
      engine.execute({ type: 'updateNote', id, note: md });
    };
    const leave = (then: () => void) => () => {
      save();
      then();
      return true;
    };
    const toContent = () => ui.focusNode(id, { kind: 'end' });
    const inFirstBlock = () => editor.state.selection.$from.index(0) === 0;
    const inLastBlock = () => editor.state.selection.$to.index(0) === editor.state.doc.childCount - 1;

    const NoteKeys = Extension.create({
      name: 'noteKeys',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Escape: leave(toContent),
          'Shift-Enter': leave(toContent),
          ArrowUp: ({ editor: e }) => (inFirstBlock() && e.view.endOfTextblock('up') ? leave(toContent)() : false),
          ArrowDown: ({ editor: e }) =>
            inLastBlock() && e.view.endOfTextblock('down') ? leave(() => actions.focusNext(id, { kind: 'start' }))() : false,
          Backspace: ({ editor: e }) => (e.isEmpty ? leave(toContent)() : false),
          // Undo/redo belong to the outline: save first, then let the key reach it.
          'Mod-z': () => (save(), false),
          'Shift-Mod-z': () => (save(), false),
          'Mod-y': () => (save(), false),
          // Tab only means something inside lists (StarterKit indents there).
          Tab: () => true,
          'Shift-Tab': () => true,
        };
      },
    });

    const editor = new Editor({
      element: host.current!,
      injectCSS: false,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          dropcursor: false,
          gapcursor: false,
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: false, linkOnPaste: true },
        }),
        Markdown.configure({ ...markdownOptions, tightLists: true, transformPastedText: true, transformCopiedText: true }),
        NoteKeys,
      ],
      content: known.current,
      editorProps: {
        attributes: {
          class: 'prose-note row-note pr-20 text-muted outline-none',
          'data-editor': 'note',
          'aria-label': 'Note',
          spellcheck: 'true',
        },
      },
      onUpdate: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(save, SAVE_DELAY_MS);
      },
      onBlur: () => save(),
    });
    editorRef.current = editor;
    loaded.current = markdownOf(editor);
    // A click on the rendered note puts the caret where it landed; otherwise at the end.
    const caret = ui.getState().focus?.caret;
    const hit = caret?.kind === 'point' ? editor.view.posAtCoords({ left: caret.x, top: caret.y }) : null;
    if (hit) editor.chain().setTextSelection(hit.pos).focus(undefined, { scrollIntoView: false }).run();
    else {
      editor.commands.focus('end');
      editor.view.dom.scrollIntoView({ block: 'nearest' });
    }
    return () => {
      save();
      editorRef.current = null;
      editor.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per note
  }, [id]);

  // External change (undo/redo): show the stored note.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || stored === known.current) return;
    known.current = stored;
    editor.commands.setContent(stored, { emitUpdate: false });
    loaded.current = markdownOf(editor);
  }, [stored]);

  return <div ref={host} className="rich-note" />;
}
