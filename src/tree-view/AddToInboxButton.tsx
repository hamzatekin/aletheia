import { Show } from 'solid-js';
import { isMac, useCoarsePointer } from '@/ui/media';
import { useOutline } from './outline-context';
import { useBottomBarUp } from './use-outline';

function PlusIcon(props: { size: number; width: number }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={props.width} stroke-linecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * The round + at the bottom right of a phone, like WorkFlowy's and Dynalist's
 * add button: a new item at the top of the Inbox, zoomed into so you can type
 * it straight away. Hidden while the editing or selection bar is up.
 */
export function AddToInboxButton() {
  const { actions } = useOutline();
  const coarse = useCoarsePointer();
  const busy = useBottomBarUp();

  return (
    <Show when={coarse() && !busy()}>
      <button
        type="button"
        // quickAdd focuses the new item's editor before the tap ends, so the phone opens its keyboard.
        onClick={() => actions.quickAdd()}
        onMouseDown={(e) => e.preventDefault()}
        class="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full bg-accent text-page shadow-lg active:scale-95"
        aria-label="Add to Inbox"
        title="Add to Inbox"
        data-testid="add-to-inbox"
      >
        <PlusIcon size={26} width={2.2} />
      </button>
    </Show>
  );
}

/**
 * The same on a computer: a + leftmost among the top-right buttons (left of
 * the sync status when sync is on). Phones have the round one instead.
 */
export function AddToInboxTopButton(props: { syncOn: boolean }) {
  const { actions } = useOutline();
  const coarse = useCoarsePointer();
  const keys = isMac ? '⌘+⌥+N' : 'Ctrl+Alt+N';

  return (
    <Show when={!coarse()}>
      <button
        type="button"
        onClick={() => actions.quickAdd()}
        onMouseDown={(e) => e.preventDefault()}
        class={[
          'top-icon fixed top-3 z-40 flex size-[34px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink',
          props.syncOn ? 'right-63' : 'right-53',
        ]}
        aria-label="Add to Inbox"
        title={`Add to Inbox (${keys})`}
        data-testid="add-to-inbox-top"
      >
        <PlusIcon size={19} width={1.8} />
      </button>
    </Show>
  );
}
