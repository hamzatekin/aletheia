import { createMemo, type Accessor } from 'solid-js';
import { useEngine } from '@/app/engine-context';
import { useTreeStore } from '@/store/tree-store';

export function StarIcon(props: { filled: boolean; size?: number }) {
  return (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
      <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
    </svg>
  );
}

/** Live starred nodes, in the order they were starred. */
export function useStarred(): Accessor<string[]> {
  const engine = useEngine();
  const version = useTreeStore(engine.store, (s) => s.version);
  return createMemo(() => {
    version(); // bumps on every change
    return [...engine.tree.all()]
      .filter((n) => n.starredAt != null && n.deletedAt === null)
      .sort((a, b) => a.starredAt! - b.starredAt!)
      .map((n) => n.id);
  });
}
