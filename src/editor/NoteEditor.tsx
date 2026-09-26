import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { notePrefs, useNotePrefs } from '@/store/note-prefs';
import { RichNoteEditor } from './RichNoteEditor';

interface Props {
  id: string;
}

/** A Markdown table: a row of cells followed by a |---| delimiter row. */
const TABLE = /^.*\|.*\n\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/m;

/** Edits a note, rendered (default) or as raw Markdown, with a toggle between the two. */
export function NoteEditor({ id }: Props) {
  const prefersRaw = useNotePrefs((s) => s.raw);
  const { engine } = useOutline();
  // The rendered editor has no tables; editing one there would flatten it.
  const hasTable = TABLE.test(engine.tree.get(id)?.note ?? '');
  const raw = prefersRaw || hasTable;
  return (
    <div className="relative">
      {raw ? <RawNoteEditor id={id} /> : <RichNoteEditor id={id} />}
      <button
        type="button"
        tabIndex={-1}
        data-testid="note-mode"
        disabled={hasTable}
        title={hasTable ? 'Notes with tables are edited as Markdown' : raw ? 'Show the note rendered' : 'Edit the note as raw Markdown'}
        className={'absolute -top-0.5 right-0 rounded px-1.5 py-0.5 text-xs text-faint hover:bg-hover hover:text-muted' + (hasTable ? ' hidden' : '')}
        // Keep focus in the note; the editor being replaced saves as it unmounts.
        onMouseDown={(e) => {
          e.preventDefault();
          notePrefs.getState().setRaw(!raw);
        }}
      >
        {raw ? 'Rendered' : 'Markdown'}
      </button>
    </div>
  );
}

/** The note's Markdown source in an auto-growing textarea. */
function RawNoteEditor({ id }: Props) {
  const { engine, ui, actions } = useOutline();
  const node = useNode(id);
  const stored = node?.note ?? '';
  const [text, setText] = useState(stored);
  const ref = useRef<HTMLTextAreaElement>(null);
  const known = useRef(stored);

  const save = (value: string) => {
    if (value === known.current) return;
    known.current = value;
    engine.execute({ type: 'updateNote', id, note: value });
  };

  // External change (undo/redo).
  useEffect(() => {
    if (stored !== known.current) {
      known.current = stored;
      setText(stored);
    }
  }, [stored]);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: 'nearest' });
    return () => save(textRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, [id]);

  const textRef = useRef(text);
  textRef.current = text;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      save(el.value);
      ui.focusNode(id, { kind: 'end' });
    } else if (e.key === 'ArrowUp' && !before.includes('\n')) {
      e.preventDefault();
      save(el.value);
      ui.focusNode(id, { kind: 'end' });
    } else if (e.key === 'ArrowDown' && !after.includes('\n')) {
      e.preventDefault();
      save(el.value);
      actions.focusNext(id, { kind: 'start' });
    } else if (e.key === 'Backspace' && el.value === '') {
      e.preventDefault();
      save('');
      ui.focusNode(id, { kind: 'end' });
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      // Let the global undo handler run with the note saved.
      save(el.value);
    }
  };

  return (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      spellCheck
      data-editor="note"
      aria-label="Note"
      placeholder="Note"
      className="prose-note row-note block w-full resize-none pr-20 font-mono overflow-hidden bg-transparent text-muted outline-none placeholder:text-faint"
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
