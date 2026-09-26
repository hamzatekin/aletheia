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
  const setRaw = (value: boolean) => notePrefs.getState().setRaw(value);
  return (
    <div>
      <NoteModeHeader raw={raw} locked={hasTable} onChange={setRaw} />
      {raw ? <RawNoteEditor id={id} /> : <RichNoteEditor id={id} />}
    </div>
  );
}

const RenderedIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M2 3.5h12M2 8h12M2 12.5h7" />
  </svg>
);
const MarkdownIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />
  </svg>
);

/**
 * A thin row above the open note: the current mode's icon at the right. On
 * hover it opens into a Rendered / Markdown switch. It takes a sliver of
 * height rather than a column of width, so the note keeps its full width.
 */
function NoteModeHeader({ raw, locked, onChange }: { raw: boolean; locked: boolean; onChange(raw: boolean): void }) {
  const option = (value: boolean, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      tabIndex={-1}
      role="radio"
      aria-checked={raw === value}
      disabled={locked && !value}
      data-testid={`note-mode-${value ? 'markdown' : 'rendered'}`}
      className={
        'flex items-center gap-1 rounded px-1.5 py-px ' +
        (raw === value ? 'bg-active text-muted' : 'hover:bg-hover hover:text-muted disabled:opacity-40 disabled:hover:bg-transparent')
      }
      // Keep focus in the note; the editor being replaced saves as it unmounts.
      onMouseDown={(e) => {
        e.preventDefault();
        if (raw !== value) onChange(value);
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <div className="flex h-5 justify-end" data-testid="note-mode">
      <div
        role="radiogroup"
        aria-label="Note editing mode"
        title={locked ? 'Notes with tables are edited as Markdown' : undefined}
        className="group/mode flex items-center rounded text-[11px] leading-none text-faint"
      >
        <span className="flex h-5 w-5 items-center justify-center group-hover/mode:hidden" aria-hidden="true">
          {raw ? <MarkdownIcon /> : <RenderedIcon />}
        </span>
        <span className="hidden items-center gap-0.5 rounded bg-surface p-0.5 shadow-sm group-hover/mode:flex">
          {option(false, 'Rendered', <RenderedIcon />)}
          {option(true, 'Markdown', <MarkdownIcon />)}
        </span>
      </div>
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
      className="prose-note row-note block w-full resize-none font-mono overflow-hidden bg-transparent text-muted outline-none placeholder:text-faint"
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
