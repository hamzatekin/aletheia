import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { Editor, Extension } from '@tiptap/core';
import { Plugin, Selection } from '@tiptap/pm/state';
import { GapCursor } from '@tiptap/pm/gapcursor';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { markdownOptions } from './markdown';
import { takeCaretHandoff } from './caret-handoff';
import { registerNoteFlush } from './note-flush';
import { gapBesideTable, lineBesideTable, noteTableExtensions } from './note-table';
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
export function RichNoteEditor(props: { id: string }) {
  const { engine, ui, actions } = useOutline();
  const node = useNode(() => props.id);
  let host: HTMLDivElement | undefined;
  let editorRef: Editor | null = null;
  /** Note text last synchronised with the store. */
  let known = '';
  /**
   * The editor's own serialization of `known`: loading normalises some
   * Markdown (list markers, spacing), and that alone must not count as an edit.
   */
  let loaded = '';
  /** The note as last loaded into the editor, so blocks left alone are saved exactly as they were. */
  let source: LoadedNote | null = null;
  const [slash, setSlashState] = createSignal<NoteSlash | null>(null, { ownedWrite: true });
  /** The same value as `slash`, readable right after a write (signals lag until the next flush). */
  let slashRef: NoteSlash | null = null;
  const setSlash = (next: NoteSlash | null) => {
    slashRef = next;
    setSlashState(next);
  };
  let runSlashRef: (index: number) => void = () => {};

  // One editor per note: made when `id` is set, destroyed (after a save) when it changes or the note closes.
  // Through a memo: effects never compare, and the parent hands over the same id again whenever its node changes.
  createEffect(
    createMemo(() => props.id),
    (id) => {
      // As stored now; the effect below follows later changes.
      known = engine.tree.get(id)?.note ?? '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      const save = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        const md = noteMarkdown(editor, source);
        if (md === loaded) return;
        loaded = md;
        known = md;
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
      // The gap cursor beside a table that opens or closes the note.
      const atGap = (side: 'start' | 'end') => {
        const { selection, doc } = editor.state;
        return selection instanceof GapCursor && selection.from === (side === 'start' ? 0 : doc.content.size);
      };

      // Undo/redo belong to the outline: save first, then run it from here, since
      // ProseMirror keeps these keys from reaching the page. When the change was
      // on this item, the caret stays in its note, as in Dynalist.
      const undoRedo = (which: 'undo' | 'redo') => () => {
        save();
        actions[which]();
        const focus = ui.getState().focus;
        if (focus?.id === id && focus.field !== 'note') ui.focusNode(id, { kind: 'end' }, 'note');
        return true;
      };

      // The "/" menu, as on the node's line: typing filters, arrows pick, Enter runs, Esc closes.
      const slashItems = () => slashCommands(slashRef?.query ?? '', 'note');
      const moveSlash = (step: number) => {
        const open = slashRef!;
        const count = Math.max(slashItems().length, 1);
        setSlash({ ...open, index: (open.index + step + count) % count });
        return true;
      };
      const runSlash = (index: number) => {
        const open = slashRef;
        const item = open && slashItems()[index];
        setSlash(null);
        if (!open || !item) return;
        editor.chain().focus().deleteRange({ from: open.from, to: editor.state.selection.from }).run();
        save();
        void item.run({ engine, editor, field: 'note', nodeId: id });
      };
      runSlashRef = runSlash;
      const syncSlash = () => {
        const open = slashRef;
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
            Escape: () => (slashRef ? (setSlash(null), true) : leave(toContent)()),
            Enter: ({ editor: e }) => {
              if (!slashRef) return e.isActive('table') && lineBesideTable(e.state, e.view.dispatch);
              const count = slashItems().length;
              if (count === 0) return (setSlash(null), false);
              runSlash(Math.min(slashRef.index, count - 1));
              return true;
            },
            'Shift-Enter': leave(toContent),
            // At the edge of a code block or table that opens or closes the note, the
            // arrow first steps out of it (a new paragraph after a code block, the
            // gap cursor beside a table), then leaves the note.
            ArrowUp: ({ editor: e }) => {
              if (slashRef) return moveSlash(-1);
              if (e.isActive('table')) return e.view.endOfTextblock('up') && gapBesideTable(e.state, -1, e.view.dispatch);
              return atGap('start') || (inFirstBlock() && e.view.endOfTextblock('up')) ? leave(toContent)() : false;
            },
            ArrowDown: ({ editor: e }) => {
              if (slashRef) return moveSlash(1);
              if (e.isActive('table')) return e.view.endOfTextblock('down') && gapBesideTable(e.state, 1, e.view.dispatch);
              return atGap('end') || (inLastBlock() && e.view.endOfTextblock('down') && !e.isActive('codeBlock'))
                ? leave(() => actions.focusNext(id, { kind: 'start' }))()
                : false;
            },
            Backspace: ({ editor: e }) => (e.isEmpty ? leave(toContent)() : false),
            'Mod-z': undoRedo('undo'),
            'Shift-Mod-z': undoRedo('redo'),
            'Mod-y': undoRedo('redo'),
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
                      if (!slashRef && opensSlashMenu(editor, from)) setSlash({ from, query: '', index: 0 });
                    });
                  return false;
                },
              },
            }),
          ];
        },
      });

      const editor = new Editor({
        element: host!,
        injectCSS: false,
        extensions: [
          StarterKit.configure({
            undoRedo: false,
            // No forced empty paragraph after a closing code block: the editor must
            // lay out exactly like the rendered note so nothing moves on click.
            trailingNode: false,
            dropcursor: false,
            // The gap cursor stays on: it lets the caret sit before or after a table with nothing beside it.
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
        content: known,
        editorProps: {
          ...CLEAR_OF_TOP_BAR,
          attributes: {
            class: 'prose-note row-note pb-0.5 text-note outline-none',
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
      editorRef = editor;
      source = loadedNote(editor, known);
      loaded = noteMarkdown(editor, source);
      // The caret goes where the note was clicked (or where it was before a
      // mode switch), else at the end. The page never jumps to show the note:
      // at most the caret itself is scrolled into view, and only from the keyboard.
      const caret = ui.getState().focus?.caret;
      const point = takeCaretHandoff(id) ?? (caret?.kind === 'point' ? caret : null);
      const hit = point ? editor.view.posAtCoords({ left: point.x, top: point.y }) : null;
      const { doc } = editor.state;
      const selection = hit
        ? // Snap to the nearest text before it: a click right of a table cell's text lands between blocks.
          Selection.near(doc.resolve(hit.pos), -1)
        : !point && caret?.kind === 'start'
          ? Selection.atStart(doc)
          : Selection.atEnd(doc);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      // Focus now, not with Tiptap's focus command: that waits for the next
      // animation frame and then writes back the selection it had, which drops
      // keys typed in between (text after Shift+Enter, End after a click), as in session.ts.
      editor.view.focus();
      if (!point) editor.commands.scrollIntoView();
      const unregister = registerNoteFlush(id, save);
      return () => {
        unregister();
        save();
        editorRef = null;
        editor.destroy();
      };
    },
  );

  // External change (undo/redo): show the stored note. On `node` too: an undo
  // right after typing saves and reverts in one render, so the note looks unchanged.
  createEffect(
    () => node(),
    (n) => {
      const stored = n?.note ?? '';
      const editor = editorRef;
      if (!editor || stored === known) return;
      known = stored;
      editor.commands.setContent(stored, { emitUpdate: false });
      source = loadedNote(editor, stored);
      loaded = noteMarkdown(editor, source);
    },
  );

  const menuItems = createMemo(() => {
    const open = slash();
    return open ? slashCommands(open.query, 'note') : [];
  });
  // Placed in the note box (positioned), not a wrapper, which would cover the floating note header.
  const slashPlace = () => {
    const open = slash();
    const view = editorRef?.view;
    const container = host?.offsetParent;
    return open && view && container ? slashPlacement(view, open.from, container, menuItems().length) : {};
  };

  return (
    <>
      <div ref={host} />
      <Show when={slash()}>
        {(open) => (
          <SlashList
            items={menuItems()}
            index={Math.min(open().index, Math.max(0, menuItems().length - 1))}
            onPick={(i) => runSlashRef(i)}
            onHover={(i) => setSlash({ ...open(), index: i })}
            style={slashPlace()}
          />
        )}
      </Show>
    </>
  );
}
