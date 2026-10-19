import { createEngine, type Engine } from '@/commands';
import { seedNodes } from '@/model';
import type { Repository } from '@/persistence';
import { createTreeStore } from '@/store/tree-store';

/** Create the engine over the given repository, seeding the sample tree on first run (unless `seed` is false). */
export async function bootstrap(repository: Repository, now: () => number, seed: boolean): Promise<Engine> {
  const store = createTreeStore();
  const engine = createEngine({ store, repository, now });
  await engine.load();
  if (seed && store.getState().nodes.size === 0) {
    await repository.replaceAllNodes(seedNodes());
    await engine.load();
  }
  return engine;
}
