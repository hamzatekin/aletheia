import { useLayoutEffect, useRef } from 'react';
import { useOutline } from '@/tree-view/outline-context';
import { useNode } from '@/tree-view/use-outline';
import { useUiStore } from '@/store/ui-store';
import { SlashMenu } from './SlashMenu';

interface Props {
  id: string;
  className?: string;
}

/** Hosts the single editor while `id` is the focused node. */
export function NodeEditor({ id, className }: Props) {
  const { session, ui } = useOutline();
  const node = useNode(id);
  const caret = useUiStore(ui, (s) => (s.focus?.id === id ? s.focus.caret : null));
  const ref = useRef<HTMLDivElement>(null);
  const content = node?.content ?? '';

  // Mount the editor here and load this node; on leave, save and unmount.
  useLayoutEffect(() => {
    const el = ref.current!;
    session.mount(el);
    session.load(id, content);
    return () => {
      session.flush();
      session.unmount();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- later content changes arrive via engine.onOperation
  }, [id, session]);

  useLayoutEffect(() => {
    if (caret) session.placeCaret(caret);
  }, [caret, id, session]);

  return (
    <div className="relative">
      <div ref={ref} className={className} data-editor="content" />
      <SlashMenu />
    </div>
  );
}
