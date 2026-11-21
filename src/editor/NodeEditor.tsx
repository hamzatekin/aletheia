import { createEffect, createMemo } from 'solid-js';
import { useOutline } from '@/tree-view/outline-context';
import { useUiStore } from '@/store/ui-store';
import { SlashMenu } from './SlashMenu';

interface Props {
  id: string;
  class?: string;
}

/** Hosts the single editor while `id` is the focused node. */
export function NodeEditor(props: Props) {
  const { engine, session, ui } = useOutline();
  const caret = useUiStore(ui, (s) => (s.focus?.id === props.id ? s.focus.caret : null));
  // Effects never compare: through a memo, they skip a parent handing over the same id again (its node changed).
  const id = createMemo(() => props.id);
  let el: HTMLDivElement | undefined;

  // Mount the editor here and load this node; on leave, save and unmount. Runs again
  // when `id` changes (the page title stays mounted while you zoom).
  createEffect(
    id,
    (id) => {
      session.mount(el!);
      // Read now from the engine: later content changes arrive via engine.onOperation.
      session.load(id, engine.tree.get(id)?.content ?? '');
      return () => {
        session.flush();
        session.unmount();
      };
    },
  );

  // After the mount effect above (effects run in the order they were made).
  createEffect(
    () => [caret(), id()] as const,
    ([c]) => {
      if (c) session.placeCaret(c);
    },
  );

  return (
    <div class="relative">
      <div ref={el} class={props.class} data-editor="content" />
      <SlashMenu />
    </div>
  );
}
