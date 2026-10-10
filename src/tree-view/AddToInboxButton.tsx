import { useNavigate } from 'react-router';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';
import { useCoarsePointer } from './use-coarse-pointer';

/**
 * The round + at the bottom right of a phone, like WorkFlowy's and Dynalist's
 * add button: a new item at the top of the Inbox, zoomed into so you can type
 * it straight away. Hidden while the editing or selection bar is up.
 */
export function AddToInboxButton() {
  const { ui, session } = useOutline();
  const navigate = useNavigate();
  const coarse = useCoarsePointer();
  const busy = useUiStore(ui, (s) => s.focus !== null || (s.selection?.ids.size ?? 0) > 0);
  if (!coarse || busy) return null;

  // The same route as the app icon's Add to Inbox shortcut. Going through it
  // also starts the editor only once the new page is up, not on this one.
  const add = () => {
    session.flush();
    ui.setSelection(null);
    void navigate('/capture');
  };

  return (
    <button
      type="button"
      onClick={add}
      onMouseDown={(e) => e.preventDefault()}
      className="add-to-inbox fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full bg-accent text-page shadow-lg active:scale-95"
      aria-label="Add to Inbox"
      title="Add to Inbox"
      data-testid="add-to-inbox"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
