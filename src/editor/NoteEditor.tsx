import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';

interface Props {
  id: string;
}

/**
 * Notes are edited as Markdown source in an auto-growing textarea, so the
 * single Tiptap instance stays reserved for node content.
 */
export function NoteEditor({ id }: Props) {
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
      className="prose-note block w-full resize-none bg-transparent text-sm leading-5 text-neutral-600 outline-none placeholder:text-neutral-400 dark:text-neutral-300"
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => save(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
