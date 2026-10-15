import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useEngine } from '@/app/engine-context';
import type { UiStore } from '@/store/ui-store';
import { addToInbox, sharedItem } from './capture';

// React runs effects twice in development; one visit must add one item.
const handled = new Set<string>();

/**
 * /share (Android's share sheet, via share_target in the manifest) and
 * /capture (the app icon's "Add to Inbox" shortcut): put a new item at the
 * top of the Inbox. A share shows the Inbox; Add to Inbox (and the + buttons,
 * Ctrl/⌘+Alt+N) zooms into a new nameless item with the caret in its text,
 * as in WorkFlowy: type the item, then go into its note if you want one.
 * Replacing the URL keeps a reload or Back from adding it again.
 */
export function CaptureRoute({ ui, mode }: { ui: UiStore; mode: 'share' | 'capture' }) {
  const engine = useEngine();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (handled.has(location.key)) return;
    handled.add(location.key);
    const params = new URLSearchParams(location.search);
    const item =
      mode === 'share'
        ? sharedItem({ title: params.get('title'), text: params.get('text'), url: params.get('url') })
        : { content: '', note: '' };
    if (mode === 'share' && item.content === '' && item.note === '') {
      void navigate('/', { replace: true });
      return;
    }
    const { inbox, id } = addToInbox(engine, item);
    // A shared item is done; a new one is for typing.
    void navigate(`/n/${mode === 'share' ? inbox : id}`, { replace: true });
    if (mode === 'capture') ui.focusNode(id, { kind: 'end' });
  }, [engine, location, mode, navigate, ui]);

  return null;
}
