import { createEngine, type Engine } from '@/commands';
import { seedNodes } from '@/model';
import { DexieRepository, type Repository } from '@/persistence';
import { createTreeStore } from '@/store/tree-store';

/** Create the engine over the given repository, seeding the sample tree on first run. */
export async function bootstrap(repository: Repository = new DexieRepository(), now?: () => number): Promise<Engine> {
  const store = createTreeStore();
  const engine = createEngine(now ? { store, repository, now } : { store, repository });
  await engine.load();
  if (store.getState().nodes.size === 0) {
    await repository.replaceAllNodes(seedNodes());
    await engine.load();
  }
  return engine;
}
