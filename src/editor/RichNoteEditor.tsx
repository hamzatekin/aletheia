import { useEffect, useRef, useState } from 'react';
import { Editor, Extension } from '@tiptap/core';
import { Plugin, Selection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { markdownOptions } from './markdown';
import { takeCaretHandoff } from './caret-handoff';
import { registerNoteFlush } from './note-flush';
import { noteTableExtensions } from './note-table';
import { noteTaskExtensions } from './note-tasks';
import { NoteImage, NoteText } from './note-text';
import { loadedNote, noteMarkdown, type LoadedNote } from './note-source';
import { SlashList, slashPlacement } from './SlashMenu';
import { opensSlashMenu, slashCommands } from './slash-registry';
import { terminalPasteMarkdown } from '@/io/terminal';
import { CLEAR_OF_TOP_BAR, SAVE_DELAY_MS } from './session';

/** The note's own "/" menu, open since a "/" was typed at document position `from`. */
interface NoteSlash {
  from: number;
  query: string;
  index: number;
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
  /** The note as last loaded into the editor, so blocks left alone are saved exactly as they were. */
  const source = useRef<LoadedNote | null>(null);
  const [slash, setSlashState] = useState<NoteSlash | null>(null);
  const slashRef = useRef<NoteSlash | null>(null);
  const setSlash = (next: NoteSlash | null) => {
    slashRef.current = next;
    setSlashState(next);
  };
  const runSlashRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const md = noteMarkdown(editor, source.current);
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

    // The "/" menu, as on the node's line: typing filters, arrows pick, Enter runs, Esc closes.
    const slashItems = () => slashCommands(slashRef.current?.query ?? '', 'note');
    const moveSlash = (step: number) => {
      const open = slashRef.current!;
      const count = Math.max(slashItems().length, 1);
      setSlash({ ...open, index: (open.index + step + count) % count });
      return true;
    };
    const runSlash = (index: number) => {
      const open = slashRef.current;
      const item = open && slashItems()[index];
      setSlash(null);
      if (!open || !item) return;
      editor.chain().focus().deleteRange({ from: open.from, to: editor.state.selection.from }).run();
      save();
      void item.run({ engine, editor, field: 'note', nodeId: id });
    };
    runSlashRef.current = runSlash;
    const syncSlash = () => {
      const open = slashRef.current;
      if (!open) return;
      const { doc, selection } = editor.state;
      const text = selection.empty && selection.from > open.from ? doc.textBetween(open.from, selection.from, '\n') : '';
      if (!text.startsWith('/') || text.includes('/', 1) || text.includes('\n')) return setSlash(null);
      if (text.slice(1) !== open.query) setSlash({ ...open, query: text.slice(1), index: 0 });
    };

    const NoteKeys = Extension.create({
      name: 'noteKeys',
      priority: 1000,
      addKeyboardShortcuts() {
        return {
          Escape: () => (slashRef.current ? (setSlash(null), true) : leave(toContent)()),
          Enter: () => {
            if (!slashRef.current) return false;
            const count = slashItems().length;
            if (count === 0) return (setSlash(null), false);
            runSlash(Math.min(slashRef.current.index, count - 1));
            return true;
          },
          'Shift-Enter': leave(toContent),
          ArrowUp: ({ editor: e }) => slashRef.current ? moveSlash(-1) : (inFirstBlock() && e.view.endOfTextblock('up') ? leave(toContent)() : false),
          // At the end of a closing code block, ArrowDown first steps out of it
          // into a new paragraph (the code block's own rule), then leaves the note.
          ArrowDown: ({ editor: e }) =>
            slashRef.current ? moveSlash(1) : inLastBlock() && e.view.endOfTextblock('down') && !e.isActive('codeBlock')
              ? leave(() => actions.focusNext(id, { kind: 'start' }))()
              : false,
          Backspace: ({ editor: e }) => (e.isEmpty ? leave(toContent)() : false),
          // Undo/redo belong to the outline: save first, then let the key reach it.
          'Mod-z': () => (save(), false),
          'Shift-Mod-z': () => (save(), false),
          'Mod-y': () => (save(), false),
          // Tab only means something inside lists, where it nests or un-nests the item.
          Tab: ({ editor: e }) => (e.commands.sinkListItem('listItem') || e.commands.sinkListItem('taskItem'), true),
          'Shift-Tab': ({ editor: e }) => (e.commands.liftListItem('listItem') || e.commands.liftListItem('taskItem'), true),
        };
      },
      addProseMirrorPlugins() {
        return [
          new Plugin({
            props: {
              // On the typed "/" rather than its key, so any keyboard layout and phone keyboards work.
              handleTextInput: (_view, _from, _to, text) => {
                if (text.endsWith('/'))
                  queueMicrotask(() => {
                    const from = editor.state.selection.from - 1;
                    if (!slashRef.current && opensSlashMenu(editor, from)) setSlash({ from, query: '', index: 0 });
                  });
                return false;
              },
            },
          }),
        ];
      },
    });

    const editor = new Editor({
      element: host.current!,
      injectCSS: false,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          // No forced empty paragraph after a closing code block: the editor must
          // lay out exactly like the rendered note so nothing moves on click.
          trailingNode: false,
          dropcursor: false,
          gapcursor: false,
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          link: { openOnClick: false, autolink: false, linkOnPaste: true },
          text: false,
        }),
        NoteText,
        NoteImage,
        Markdown.configure({ ...markdownOptions, tightLists: true, transformPastedText: true, transformCopiedText: true }),
        ...noteTableExtensions,
        ...noteTaskExtensions,
        NoteKeys,
      ],
      content: known.current,
      editorProps: {
        ...CLEAR_OF_TOP_BAR,
        attributes: {
          class: 'prose-note row-note pb-0.5 text-muted outline-none',
          'data-editor': 'note',
          'aria-label': 'Note',
          spellcheck: 'true',
        },
        // Terminal output (box tables, Claude Code answers) pastes as the Markdown it was.
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          const markdown = data ? terminalPasteMarkdown(data.getData('text/plain'), data.getData('text/html')) : null;
          if (editor.isActive('codeBlock') || markdown === null) return false;
          editor.commands.insertContent(markdown);
          return true;
        },
      },
      onUpdate: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(save, SAVE_DELAY_MS);
      },
      onTransaction: () => syncSlash(),
      onBlur: () => {
        setSlash(null);
        save();
      },
    });
    editorRef.current = editor;
    source.current = loadedNote(editor, known.current);
    loaded.current = noteMarkdown(editor, source.current);
    // The caret goes where the note was clicked (or where it was before a
    // mode switch), else at the end. The page never jumps to show the note:
    // at most the caret itself is scrolled into view, and only from the keyboard.
    const caret = ui.getState().focus?.caret;
    const point = takeCaretHandoff(id) ?? (caret?.kind === 'point' ? caret : null);
    const hit = point ? editor.view.posAtCoords({ left: point.x, top: point.y }) : null;
    if (hit) {
      // Snap to the nearest text before it: a click right of a table cell's text lands between blocks.
      editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(hit.pos), -1)));
      editor.commands.focus(undefined, { scrollIntoView: false });
    }
    else if (point) editor.commands.focus('end', { scrollIntoView: false });
    else {
      editor.commands.focus('end', { scrollIntoView: false });
      editor.commands.scrollIntoView();
    }
    const unregister = registerNoteFlush(id, save);
    return () => {
      unregister();
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
    source.current = loadedNote(editor, stored);
    loaded.current = noteMarkdown(editor, source.current);
  }, [stored]);

  const slashItems = slash ? slashCommands(slash.query, 'note') : [];
  const view = editorRef.current?.view;
  // Placed in the note box (positioned), not a wrapper, which would cover the floating note header.
  const container = host.current?.offsetParent;
  const slashPlace = slash && view && container ? slashPlacement(view, slash.from, container, slashItems.length) : {};

  return (
    <>
      <div ref={host} className="rich-note" />
      {slash && (
        <SlashList
          items={slashItems}
          index={Math.min(slash.index, Math.max(0, slashItems.length - 1))}
          onPick={(i) => runSlashRef.current(i)}
          onHover={(i) => setSlash({ ...slash, index: i })}
          style={slashPlace}
        />
      )}
    </>
  );
}
