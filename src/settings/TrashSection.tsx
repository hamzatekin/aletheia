import { createMemo, createSignal, For, Show } from 'solid-js';
import { useEngine } from '@/app/engine-context';
import { plainText } from '@/editor/markdown';
import { deletedItems } from '@/model';
import { useTreeStore } from '@/store/tree-store';
import { useOutline } from '@/tree-view/outline-context';
import { isWide } from '@/ui/media';
import { Button, ago } from '@/ui/widgets';

/** When something was deleted: "5 min ago" within the hour, then the time today, then the date. */
function deletedWhen(at: number, now = Date.now()): string {
  if (now - at < 3_600_000) return ago(at);
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Recently deleted: what was deleted, newest first, each with Restore. Deleted
 * items are kept (and synced) anyway, so this is a view, not a second copy.
 */
export function TrashSection() {
  const engine = useEngine();
  const { ui, session, actions } = useOutline();
  const [open, setOpen] = createSignal(false);
  const [restored, setRestored] = createSignal<{ id: string; title: string } | null>(null);
  const structureVersion = useTreeStore(engine.store, (s) => s.structureVersion);
  const items = createMemo(() => {
    structureVersion(); // the tree changed: list again
    return open() ? deletedItems(engine.tree) : [];
  });

  const title = (content: string) => plainText(content).trim() || 'Untitled';
  const restore = (id: string, content: string) => {
    session.flush();
    if (engine.execute({ type: 'restoreNode', id }).ok) setRestored({ id, title: title(content) });
  };
  const show = (id: string) => {
    actions.revealNode(id);
    if (!isWide()) ui.setSettingsOpen(false);
  };

  return (
    <section data-testid="trash-section" class="mt-4 border-t border-line pt-4">
      <button
        type="button"
        class="flex w-full items-center justify-between font-semibold"
        aria-expanded={open() ? 'true' : 'false'}
        data-testid="trash-toggle"
        onClick={() => setOpen(!open())}
      >
        Recently deleted
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" class={['text-faint', { '-rotate-90': !open() }]} aria-hidden="true">
          <path d="M1.5 3.2 5 6.8l3.5-3.6z" />
        </svg>
      </button>
      <Show when={open()}>
        <p class="mt-1 mb-2 text-xs text-muted">Restore puts an item back where it was, with what was deleted along with it.</p>
        <Show
          when={items().length > 0}
          fallback={
            <p class="text-xs text-muted" data-testid="trash-empty">
              Nothing deleted.
            </p>
          }
        >
          <ul data-testid="trash-list">
            <For each={items()} keyed={(item) => item.node.id}>
              {(item) => {
                const node = () => item().node;
                const where = () => {
                  const parentId = node().parentId;
                  const parent = parentId === null ? null : engine.tree.get(parentId);
                  return parent && parent.deletedAt === null ? title(parent.content) : null;
                };
                return (
                  <li class="flex items-center justify-between gap-2 border-b border-line py-1.5 last:border-0" data-testid="trash-item">
                    <div class="min-w-0">
                      <div class="truncate">{title(node().content)}</div>
                      <div class="truncate text-xs text-muted">
                        {deletedWhen(node().deletedAt!)}
                        {item().inside > 0 && ` · ${item().inside} inside`}
                        {where() && ` · from ${where()}`}
                      </div>
                    </div>
                    <Button onClick={() => restore(node().id, node().content)}>Restore</Button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={restored()}>
        {(done) => (
          <p role="status" class="mt-2 text-xs text-muted">
            Restored “{done().title}”.{' '}
            <button type="button" class="text-accent hover:underline" onClick={() => show(done().id)}>
              Show it
            </button>
          </p>
        )}
      </Show>
    </section>
  );
}
