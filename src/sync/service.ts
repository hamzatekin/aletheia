import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Engine } from '@/commands';
import { repairTree, type Node } from '@/model';
import { REMOTE_OP, type SyncRepository } from '@/persistence/repository';
import { entriesForAll } from './outbox';
import { fromWire, overlayPending, tombstone, toWire, type PullResponse, type ServerNode, type WireNode } from './wire';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** This device's sync key, or null when sync is off. */
  key: string | null;
  lastSyncedAt: number | null;
  error: string | null;
  /** A key from an opened sync link, waiting for the user to confirm joining. */
  pendingJoinKey: string | null;
}

export interface SyncApi {
  createSpace(key: string): Promise<void>;
  /** Resolves true if the space exists. */
  checkSpace(key: string): Promise<boolean>;
  push(key: string, nodes: WireNode[]): Promise<void>;
  pull(key: string, since: number, limit: number): Promise<PullResponse>;
}

/** The server answered with an error (as opposed to the network failing). */
export class SyncServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const META_KEY = 'syncKey';
const META_CURSOR = 'syncCursor';
const PUSH_BATCH = 200;
/** Stay well under the Worker's request body and D1's statement limits. */
const PUSH_MAX_BYTES = 800_000;
const PULL_PAGE = 500;

export interface SyncServiceOptions {
  now?: () => number;
  /** Wait this long after the last edit before uploading. */
  debounceMs?: number;
  /** Called after joining replaced every local node (rebuild indexes, drop focus). */
  afterReplace?: () => void;
}

/**
 * Opt-in sync. Local-first: every edit lands in IndexedDB as before, and the
 * repository also notes it in an outbox. A sync uploads the outbox, then
 * downloads everything changed on the server since the last sync, merges it
 * field group by field group (the newest change wins), and repairs the tree
 * if two devices' edits clash (see `repairTree`).
 */
export class SyncService {
  readonly state: StoreApi<SyncState>;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly afterReplace: () => void;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly engine: Engine,
    private readonly repo: SyncRepository,
    private readonly api: SyncApi,
    opts: SyncServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.debounceMs = opts.debounceMs ?? 2000;
    this.afterReplace = opts.afterReplace ?? (() => {});
    this.state = createStore<SyncState>(() => ({ status: 'off', key: null, lastSyncedAt: null, error: null, pendingJoinKey: null }));
    this.unsubscribe = engine.onOperation((op) => {
      if (op.type !== REMOTE_OP && this.key) this.schedule();
    });
  }

  private get key(): string | null {
    return this.state.getState().key;
  }

  /** Resume sync if this device has it turned on. */
  async start(): Promise<void> {
    const key = await this.repo.getMeta<string>(META_KEY);
    if (!key) return;
    this.repo.setTracking(true);
    this.state.setState({ key, status: 'idle' });
    void this.sync();
  }

  /** Turn sync on with a new key, uploading this device's notes. Returns the key. */
  async enable(): Promise<string> {
    const key = generateKey();
    await this.api.createSpace(key);
    this.repo.setTracking(true);
    await this.engine.flush();
    await this.repo.enqueue(entriesForAll(this.engine.tree.all()));
    await this.repo.setMeta(META_CURSOR, 0);
    await this.repo.setMeta(META_KEY, key);
    this.state.setState({ key, status: 'idle', error: null, pendingJoinKey: null });
    await this.sync();
    return key;
  }

  /**
   * Join an existing sync space. `replace` drops this device's notes and takes
   * the synced ones; `merge` uploads this device's notes into the space too.
   */
  async join(key: string, mode: 'replace' | 'merge'): Promise<void> {
    if (!(await this.api.checkSpace(key))) throw new SyncServerError('That sync link is not valid on this server.', 404);
    if (mode === 'replace') {
      this.repo.setTracking(false);
      await this.engine.replaceAll([]);
      await this.repo.clearOutbox();
      this.afterReplace();
    } else {
      await this.engine.flush();
      await this.repo.enqueue(entriesForAll(this.engine.tree.all()));
    }
    this.repo.setTracking(true);
    await this.repo.setMeta(META_CURSOR, 0);
    await this.repo.setMeta(META_KEY, key);
    this.state.setState({ key, status: 'idle', error: null, pendingJoinKey: null });
    await this.sync();
  }

  /** Stop syncing on this device. Notes stay here; the server copy is untouched. */
  async disable(): Promise<void> {
    this.cancelTimer();
    await this.running;
    this.repo.setTracking(false);
    await this.repo.clearOutbox();
    await this.repo.deleteMeta(META_KEY);
    await this.repo.deleteMeta(META_CURSOR);
    this.state.setState({ key: null, status: 'off', error: null, lastSyncedAt: null });
  }

  setPendingJoin(key: string | null): void {
    this.state.setState({ pendingJoinKey: key });
  }

  /** Sync now. Concurrent calls share one run (plus one more if asked mid-run). */
  sync(): Promise<void> {
    this.cancelTimer();
    if (!this.key) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again && this.key);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Run `sync` after edits settle. */
  schedule(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => void this.sync(), this.debounceMs);
  }

  destroy(): void {
    this.cancelTimer();
    this.unsubscribe();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async runOnce(): Promise<void> {
    const key = this.key!;
    this.state.setState({ status: 'syncing' });
    try {
      await this.pushAll(key);
      await this.pullAll(key);
      const fixes = repairTree(this.engine.tree, this.now());
      if (fixes.length > 0) {
        this.engine.applyExternal(fixes, 'repair');
        await this.pushAll(key);
      }
      if (this.key === key) this.state.setState({ status: 'idle', error: null, lastSyncedAt: this.now() });
    } catch (error) {
      if (this.key !== key) return;
      if (error instanceof SyncServerError) this.state.setState({ status: 'error', error: error.message });
      else this.state.setState({ status: 'offline', error: null });
    }
  }

  private async pushAll(key: string): Promise<void> {
    await this.engine.flush(); // outbox entries are written with the commit
    for (let round = 0; round < 100; round++) {
      const entries = await this.repo.listOutbox(PUSH_BATCH);
      if (entries.length === 0) return;
      const wires: WireNode[] = [];
      const sent = [];
      let bytes = 0;
      for (const e of entries) {
        const node = this.engine.tree.get(e.nodeId);
        const wire = node ? toWire(node, e.t) : tombstone(e.nodeId, e.t.deleted ?? this.now());
        const size = wire.content.length + wire.note.length + 200;
        if (wires.length > 0 && bytes + size > PUSH_MAX_BYTES) break;
        wires.push(wire);
        sent.push(e);
        bytes += size;
      }
      await this.api.push(key, wires);
      await this.repo.ackOutbox(sent);
    }
  }

  private async pullAll(key: string): Promise<void> {
    let cursor = (await this.repo.getMeta<number>(META_CURSOR)) ?? 0;
    for (;;) {
      const page = await this.api.pull(key, cursor, PULL_PAGE);
      if (this.key !== key) return;
      await this.applyRemote(page.nodes);
      await this.engine.flush(); // nodes are on disk before the cursor moves past them
      cursor = page.cursor;
      await this.repo.setMeta(META_CURSOR, cursor);
      if (!page.more) return;
    }
  }

  private async applyRemote(remote: readonly ServerNode[]): Promise<void> {
    if (remote.length === 0) return;
    const pending = await this.repo.getOutbox(remote.map((n) => n.id));
    const nodes: Node[] = remote.map((w) =>
      overlayPending(fromWire(w), this.engine.tree.get(w.id), pending.get(w.id)?.t, w.t),
    );
    this.engine.applyExternal(nodes, REMOTE_OP);
  }
}

/** 32 random bytes, base64url. The key is the only credential, so it is long. */
export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `https://host/#sync=KEY`. The key sits in the fragment, which browsers never send to the server. */
export function syncLink(origin: string, key: string): string {
  return `${origin}/#sync=${key}`;
}

/** The key from a sync link's fragment, if there is one. */
export function keyFromHash(hash: string): string | null {
  const m = /(?:^#|&)sync=([A-Za-z0-9_-]{32,})/.exec(hash);
  return m ? m[1]! : null;
}

/** The sync API over HTTP (same origin as the app). */
export function httpSyncApi(base = '', fetchFn: typeof fetch = (...args) => fetch(...args)): SyncApi {
  const call = async (key: string, method: string, path: string, body?: unknown): Promise<Response> => {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    }
    return fetchFn(`${base}/api/sync/${path}`, init);
  };
  const fail = async (res: Response): Promise<never> => {
    let message = `Sync server error (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON; keep the generic message
    }
    throw new SyncServerError(message, res.status);
  };
  return {
    async createSpace(key) {
      const res = await call(key, 'POST', 'space');
      if (!res.ok) await fail(res);
    },
    async checkSpace(key) {
      const res = await call(key, 'GET', 'space');
      if (res.status === 404) return false;
      if (!res.ok) await fail(res);
      return true;
    },
    async push(key, nodes) {
      const res = await call(key, 'POST', 'push', { nodes });
      if (!res.ok) await fail(res);
    },
    async pull(key, since, limit) {
      const res = await call(key, 'GET', `pull?since=${since}&limit=${limit}`);
      if (!res.ok) await fail(res);
      return (await res.json()) as PullResponse;
    },
  };
}
