import { onSettled } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { useEngine } from '@/app/engine-context';
import { useAppNavigate } from '@/app/routing';
import type { UiStore } from '@/store/ui-store';
import { addToInbox, sharedItem } from './capture';

/**
 * /share (Android's share sheet, via share_target in the manifest) and
 * /capture (the app icon's "Add to Inbox" shortcut): put a new item at the
 * top of the Inbox. A share shows the Inbox; Add to Inbox (and the + buttons,
 * Ctrl/⌘+Alt+N) zooms into a new nameless item with the caret in its text,
 * as in WorkFlowy: type the item, then go into its note if you want one.
 * Replacing the URL keeps a reload or Back from adding it again.
 */
export function CaptureRoute(props: { ui: UiStore; mode: 'share' | 'capture' }) {
  const engine = useEngine();
  const location = useLocation();
  const navigate = useAppNavigate();

  // onSettled runs once per visit (this page is replaced right away), inside the
  // flush that mounts it, so after a tap on a + button the new item's editor has
  // the focus before the tap ends and the phone opens its keyboard (see quickAdd).
  // No timer or microtask on this path.
  onSettled(() => {
    const params = new URLSearchParams(location.search);
    const item =
      props.mode === 'share'
        ? sharedItem({ title: params.get('title'), text: params.get('text'), url: params.get('url') })
        : { content: '', note: '' };
    if (props.mode === 'share' && item.content === '' && item.note === '') {
      navigate('/', { replace: true });
      return;
    }
    const { inbox, id } = addToInbox(engine, item);
    // A shared item is done; a new one is for typing.
    navigate(`/n/${props.mode === 'share' ? inbox : id}`, { replace: true });
    if (props.mode === 'capture') props.ui.focusNode(id, { kind: 'end' });
  });

  return null;
}
