import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { isNoteCollapsed, notePrefs, useNotePrefs } from '@/store/note-prefs';
import { RichNoteEditor } from './RichNoteEditor';
import { keepCaretAcrossSwitch } from './caret-handoff';
import { flushNote, registerNoteFlush } from './note-flush';
import { isTerminalPaste, terminalToMarkdown } from '@/io/terminal';

interface Props {
  id: string;
}

/** Which way notes are edited on this device: rendered (default) or raw Markdown. */
export function useNoteMode(): { raw: boolean } {
  return { raw: useNotePrefs((s) => s.raw) };
}

/** Edits a note, rendered (default) or as raw Markdown, under the note header. */
export function NoteEditor({ id }: Props) {
  // Opening a note to edit it unfolds it, and it stays open afterwards.
  useEffect(() => {
    if (isNoteCollapsed(notePrefs.getState(), id)) notePrefs.getState().toggleCollapsed(id, false);
  }, [id]);
  const { raw } = useNoteMode();
  return (
    <div className="note-box relative flow-root">
      <NoteHeader id={id} raw={raw} overlay={raw} />
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
 * The icon at the upper right of every expanded note, shown the same way
 * whether the note is being read or edited, so nothing moves when you click
 * in or out. It floats, so the note's first line wraps around it and the note
 * starts right under its node instead of under a header row. It shows the
 * current mode (lines for rendered, <> for Markdown); clicking it switches.
 * `quiet` hides it until the row is hovered. `overlay` pins it over the raw
 * textarea instead, which reserves room for it on the right.
 */
export function NoteHeader({ id, raw, quiet = false, overlay = false }: { id: string; raw: boolean; quiet?: boolean; overlay?: boolean }) {
  const tip = raw ? 'Markdown. Click to edit rendered' : 'Rendered. Click to edit as Markdown';
  // Hidden until the row is hovered, except on touch screens, which have no hover.
  const reveal = quiet ? 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100' : '';
  const button = 'flex h-5 w-5 items-center justify-center rounded text-faint transition-opacity hover:bg-hover hover:text-muted ';
  return (
    <div className={'note-header flex gap-0.5 ' + (overlay ? 'absolute top-0 right-0 z-[1]' : 'float-right ml-2')} data-testid="note-mode">
      <CopyNoteButton id={id} className={button + reveal} />
      <button
        type="button"
        tabIndex={-1}
        title={tip}
        aria-label={tip}
        aria-pressed={raw}
        data-testid="note-mode-toggle"
        className={button + reveal}
        // Keep focus where it is; an open editor being replaced saves as it unmounts.
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          keepCaretAcrossSwitch();
          // Hold the note's height while one editor replaces the other, so the
          // page (and the virtual list's scroll anchoring) never sees it shrink.
          const box = e.currentTarget.closest<HTMLElement>('.note-box');
          if (box) {
            box.style.minHeight = `${box.getBoundingClientRect().height}px`;
            requestAnimationFrame(() => requestAnimationFrame(() => (box.style.minHeight = '')));
          }
          notePrefs.getState().setRaw(!raw);
        }}
      >
        {raw ? <MarkdownIcon /> : <RenderedIcon />}
      </button>
    </div>
  );
}

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 8.5 3.2 3L13 4.5" />
  </svg>
);

/** Copies the note's Markdown source, whichever way it is shown, and ticks for a moment. */
function CopyNoteButton({ id, className }: { id: string; className: string }) {
  const { engine } = useOutline();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  const tip = copied ? 'Copied' : 'Copy Markdown';
  return (
    <button
      type="button"
      tabIndex={-1}
      title={tip}
      aria-label={tip}
      data-testid="note-copy"
      className={className + (copied ? ' opacity-100!' : '')}
      // Keep focus (and the caret) in an open editor.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        flushNote(id);
        const note = engine.tree.get(id)?.note ?? '';
        void navigator.clipboard?.writeText(note).then(() => setCopied(true), () => {});
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
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
    // Measuring collapses the textarea for a moment, which can shorten the page
    // and pull the scroll position up; put it back so nothing jumps.
    const { scrollX, scrollY } = window;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
    if (window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
  }, [text]);

  useEffect(() => {
    const el = ref.current!;
    // Never scroll the page to show the note: it is already on screen where
    // it was clicked or opened.
    // (Selecting before focusing: on a focused textarea Chrome scrolls to the new caret.)
    el.setSelectionRange(el.value.length, el.value.length);
    el.focus({ preventScroll: true });
    const unregister = registerNoteFlush(id, () => save(textRef.current));
    return () => {
      unregister();
      save(textRef.current);
    };
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
      className="prose-note row-note block w-full resize-none pr-6 font-mono overflow-hidden bg-transparent text-muted outline-none placeholder:text-faint"
      onChange={(e) => setText(e.target.value)}
      onPaste={(e) => {
        // Terminal output (box tables, Claude Code answers) pastes as the Markdown it was.
        const pasted = e.clipboardData.getData('text/plain');
        if (!isTerminalPaste(pasted)) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setRangeText(terminalToMarkdown(pasted), el.selectionStart, el.selectionEnd, 'end');
        setText(el.value);
      }}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
