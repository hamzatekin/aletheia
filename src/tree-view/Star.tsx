import { useMemo } from 'react';
import { useEngine } from '@/app/engine-context';
import { useTreeStore } from '@/store/tree-store';

export function StarIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
    </svg>
  );
}

/** Live starred nodes, in the order they were starred. */
export function useStarred(): string[] {
  const engine = useEngine();
  const version = useTreeStore(engine.store, (s) => s.version);
  return useMemo(
    () =>
      [...engine.tree.all()]
        .filter((n) => n.starredAt != null && n.deletedAt === null)
        .sort((a, b) => a.starredAt! - b.starredAt!)
        .map((n) => n.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` bumps on every change
    [engine, version],
  );
}
