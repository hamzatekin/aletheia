import type { Engine } from '@/commands';
import type { Node } from '@/model';
import { PEER_OP, REMOTE_OP } from '@/persistence/repository';
import type { SyncService } from './service';

type Message =
  /** Nodes a tab just saved. `local` = edited there (not pulled from the server). */
  | { type: 'nodes'; nodes: { id: string; after: Node | null }[]; local: boolean }
  /** A tab replaced every node (import, joining sync with "use synced notes"). */
  | { type: 'replaced' }
  /** A tab turned sync on or off. */
  | { type: 'sync-key' };

export interface TabsOptions {
  /** Another tab replaced every node. Default: reload this tab. */
  onReplaced?: () => void;
}

/**
 * Keep every open tab of the app (and the installed app) showing the same
 * notes. They share one IndexedDB, but each holds the tree in memory; without
 * this a tab left open shows, and then saves, stale copies of nodes.
 *
 * Each saved change is broadcast to the other tabs, which show it without
 * saving it again. A tab that comes back into view re-reads the disk too, in
 * case the browser froze it and it missed messages.
 */
export function connectTabs(engine: Engine, sync: SyncService, opts: TabsOptions = {}): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel('aletheia-tabs');
  const send = (m: Message) => channel.postMessage(m);
  const onReplaced = opts.onReplaced ?? (() => window.location.reload());

  const offOp = engine.onOperation((op) => {
    if (op.type === PEER_OP || op.changes.length === 0) return;
    send({ type: 'nodes', nodes: op.changes.map((c) => ({ id: c.id, after: c.after })), local: op.type !== REMOTE_OP });
  });
  const offReplace = engine.onReplace(() => send({ type: 'replaced' }));

  let { key, lastKey } = sync.state.getState();
  let following = false;
  const offState = sync.state.subscribe((s) => {
    if (s.key === key && s.lastKey === lastKey) return;
    ({ key, lastKey } = s);
    if (!following) send({ type: 'sync-key' });
  });

  channel.onmessage = (event: MessageEvent<Message>) => {
    const m = event.data;
    if (m.type === 'nodes') {
      engine.applyPeer(m.nodes);
      // Backup in case that tab closes before its own upload runs.
      if (m.local) sync.schedule();
    } else if (m.type === 'replaced') {
      onReplaced();
    } else if (m.type === 'sync-key') {
      following = true;
      void sync.reloadKey().finally(() => {
        following = false;
      });
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void engine.reload();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    offOp();
    offReplace();
    offState();
    document.removeEventListener('visibilitychange', onVisible);
    channel.close();
  };
}
