import { newId, type Node, type NodeChange, type Operation, type TreeReader } from '@/model';
import type { Repository } from '@/persistence';
import { PEER_OP } from '@/persistence/repository';
import { readerOf, type TreeStore } from '@/store/tree-store';
import { computeEffect } from './dispatch';
import { isRejection, type Command, type FocusHint } from './types';

export type Outcome =
  | { ok: true; op: Operation; focus?: FocusHint }
  | { ok: false; reason: string };

export interface EngineOptions {
  store: TreeStore;
  repository: Repository;
  now?: () => number;
  onPersistError?: (error: unknown, op: Operation) => void;
}

/** A command, or a function that derives one from the tree as it is mid-batch. */
export type BatchItem = Command | ((tree: TreeReader) => Command | null);

/**
 * Runs commands: applies to the store synchronously (instant UI), persists in
 * order through a write queue, appends to the operation log, and keeps
 * in-memory undo/redo stacks.
 */
export interface Engine {
  readonly store: TreeStore;
  readonly tree: TreeReader;
  execute(cmd: Command): Outcome;
  /**
   * Run several commands as one undo step and one operation. Each item sees
   * the tree as left by the previous one; rejected items are skipped.
   */
  batch(items: BatchItem[], type?: string): Outcome;
  undo(): Outcome | null;
  redo(): Outcome | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Resolves once every queued write has been persisted. */
  flush(): Promise<void>;
  /** Load nodes from the repository into the store. */
  load(): Promise<void>;
  /** Replace every node (restore from backup). Not undoable; clears the stacks. */
  replaceAll(nodes: Node[]): Promise<void>;
  /**
   * Write node versions that came from outside this device's commands (sync
   * pulls, tree repairs). Not undoable. Nodes identical to the current ones
   * are skipped; returns the operation, or null when nothing changed.
   */
  applyExternal(nodes: readonly Node[], type: string): Operation | null;
  /**
   * Show node versions another tab already wrote to disk: updates the store
   * and tells listeners (as a `PEER_OP` operation) but writes nothing. `null`
   * removes the node. Returns the operation, or null when nothing changed.
   */
  applyPeer(nodes: readonly { id: string; after: Node | null }[]): Operation | null;
  /** Re-read every node from disk and show whatever another tab changed there. */
  reload(): Promise<void>;
  /** Subscribe to wholesale replaces (`replaceAll`). Returns unsubscribe. */
  onReplace(listener: () => void): () => void;
  /** Subscribe to committed operations (search index, etc.). Returns unsubscribe. */
  onOperation(listener: (op: Operation) => void): () => void;
}

export function createEngine(opts: EngineOptions): Engine {
  const { store, repository } = opts;
  const now = opts.now ?? Date.now;
  const tree = readerOf(store);
  const undoStack: Operation[] = [];
  const redoStack: Operation[] = [];
  const listeners = new Set<(op: Operation) => void>();
  const replaceListeners = new Set<() => void>();
  /** While `reload` reads the disk: nodes this tab changed meanwhile (its copy is newer). */
  let changedDuringReload: Set<string> | null = null;
  let queue: Promise<void> = Promise.resolve();

  function commit(op: Operation): void {
    store.getState().applyChanges(op.changes);
    persist(op);
  }

  function persist(op: Operation): void {
    const upserts = [];
    const removals: string[] = [];
    for (const c of op.changes) {
      if (c.after) upserts.push(c.after);
      else removals.push(c.id);
    }
    const batch = { upserts, removals, operation: op };
    if (changedDuringReload) for (const c of op.changes) changedDuringReload.add(c.id);
    // The queue never rejects: each step catches its own error so later
    // writes still run in order.
    queue = queue
      .then(() => repository.commit(batch))
      .catch((error: unknown) => {
        (opts.onPersistError ?? ((e) => console.error('persist failed', e)))(error, op);
      });
    for (const l of listeners) l(op);
  }

  function applyPeer(nodes: readonly { id: string; after: Node | null }[]): Operation | null {
    const changes: NodeChange[] = [];
    for (const { id, after } of nodes) {
      const before = tree.get(id) ?? null;
      if (before === null && after === null) continue;
      if (before && after && sameNode(before, after) && before.updatedAt === after.updatedAt) continue;
      changes.push({ id, before, after });
    }
    if (changes.length === 0) return null;
    store.getState().applyChanges(changes);
    const op: Operation = { id: newId(), type: PEER_OP, input: null, changes, affectedNodeIds: changes.map((c) => c.id), timestamp: now() };
    for (const l of listeners) l(op);
    return op;
  }

  function invert(changes: readonly NodeChange[], at: number): NodeChange[] {
    return changes.map((c) => ({
      id: c.id,
      before: c.after,
      after: c.before ? { ...c.before, updatedAt: at } : null,
    }));
  }

  function reapply(changes: readonly NodeChange[], at: number): NodeChange[] {
    return changes.map((c) => ({
      id: c.id,
      before: c.before,
      after: c.after ? { ...c.after, updatedAt: at } : null,
    }));
  }

  return {
    store,
    tree,

    execute(cmd) {
      const at = now();
      const effect = computeEffect({ tree, now: at }, cmd);
      if (isRejection(effect)) return { ok: false, reason: effect.reason };
      if (effect.changes.length === 0) {
        return effect.focus ? { ok: true, op: noop(cmd, at), focus: effect.focus } : { ok: true, op: noop(cmd, at) };
      }
      const op: Operation = {
        id: newId(),
        type: cmd.type,
        input: cmd,
        changes: effect.changes,
        affectedNodeIds: effect.affectedNodeIds,
        timestamp: at,
      };
      commit(op);
      undoStack.push(op);
      redoStack.length = 0;
      return effect.focus ? { ok: true, op, focus: effect.focus } : { ok: true, op };
    },

    batch(items, type = 'batch') {
      const at = now();
      const merged = new Map<string, NodeChange>();
      const affected = new Set<string>();
      let focus: FocusHint | undefined;
      const inputs: Command[] = [];
      for (const item of items) {
        const cmd = typeof item === 'function' ? item(tree) : item;
        if (!cmd) continue;
        const effect = computeEffect({ tree, now: at }, cmd);
        if (isRejection(effect) || effect.changes.length === 0) continue;
        store.getState().applyChanges(effect.changes);
        for (const c of effect.changes) {
          const prev = merged.get(c.id);
          merged.set(c.id, { id: c.id, before: prev ? prev.before : c.before, after: c.after });
        }
        for (const id of effect.affectedNodeIds) affected.add(id);
        if (effect.focus) focus = effect.focus;
        inputs.push(cmd);
      }
      const changes = [...merged.values()].filter((c) => c.before !== null || c.after !== null);
      if (changes.length === 0) return { ok: false, reason: 'nothing to do' };
      const op: Operation = { id: newId(), type, input: inputs, changes, affectedNodeIds: [...affected], timestamp: at };
      persist(op);
      undoStack.push(op);
      redoStack.length = 0;
      return focus ? { ok: true, op, focus } : { ok: true, op };
    },

    undo() {
      const target = undoStack.pop();
      if (!target) return null;
      const at = now();
      const op: Operation = {
        id: newId(),
        type: 'undo',
        input: null,
        changes: invert(target.changes, at),
        affectedNodeIds: target.affectedNodeIds,
        timestamp: at,
        targetOpId: target.id,
      };
      commit(op);
      redoStack.push(target);
      return { ok: true, op, focus: focusForUndo(target) };
    },

    redo() {
      const target = redoStack.pop();
      if (!target) return null;
      const at = now();
      const op: Operation = {
        id: newId(),
        type: 'redo',
        input: null,
        changes: reapply(target.changes, at),
        affectedNodeIds: target.affectedNodeIds,
        timestamp: at,
        targetOpId: target.id,
      };
      commit(op);
      undoStack.push(target);
      return { ok: true, op, focus: focusForRedo(target) };
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    flush: () => queue,

    async load() {
      store.getState().load(await repository.loadAllNodes());
    },

    async replaceAll(nodes) {
      await queue;
      await repository.replaceAllNodes(nodes, now());
      undoStack.length = 0;
      redoStack.length = 0;
      store.getState().load(nodes);
      for (const l of replaceListeners) l();
    },

    applyExternal(nodes, type) {
      const changes: NodeChange[] = [];
      for (const after of nodes) {
        const before = tree.get(after.id) ?? null;
        if (before && sameNode(before, after)) continue;
        changes.push({ id: after.id, before, after });
      }
      if (changes.length === 0) return null;
      const ids = changes.map((c) => c.id);
      const op: Operation = { id: newId(), type, input: null, changes, affectedNodeIds: ids, timestamp: now() };
      commit(op);
      return op;
    },

    applyPeer,

    async reload() {
      const changed = (changedDuringReload = new Set());
      let onDisk: Node[];
      try {
        await queue; // this tab's own writes are on disk first
        onDisk = await repository.loadAllNodes();
      } finally {
        changedDuringReload = null;
      }
      const seen = new Set<string>();
      const nodes: { id: string; after: Node | null }[] = [];
      for (const n of onDisk) {
        seen.add(n.id);
        if (!changed.has(n.id)) nodes.push({ id: n.id, after: n });
      }
      for (const n of tree.all()) if (!seen.has(n.id) && !changed.has(n.id)) nodes.push({ id: n.id, after: null });
      applyPeer(nodes);
    },

    onReplace(listener) {
      replaceListeners.add(listener);
      return () => replaceListeners.delete(listener);
    },

    onOperation(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function sameNode(a: Node, b: Node): boolean {
  return (
    a.parentId === b.parentId &&
    a.order === b.order &&
    a.content === b.content &&
    a.note === b.note &&
    a.collapsed === b.collapsed &&
    (a.starredAt ?? null) === (b.starredAt ?? null) &&
    a.deletedAt === b.deletedAt &&
    a.createdAt === b.createdAt
  );
}

function noop(cmd: Command, at: number): Operation {
  return { id: newId(), type: cmd.type, input: cmd, changes: [], affectedNodeIds: [], timestamp: at };
}

/** After undo, focus the first node that still exists (prefer the command's subject). */
function focusForUndo(target: Operation): FocusHint {
  const subject = subjectId(target);
  const surviving = target.changes.filter((c) => c.before !== null);
  const pick = surviving.find((c) => c.id === subject) ?? surviving[0];
  const id = pick?.id ?? subject ?? '';
  const content = pick?.before?.content ?? '';
  return { id, offset: content.length };
}

function focusForRedo(target: Operation): FocusHint {
  const subject = subjectId(target);
  const surviving = target.changes.filter((c) => c.after !== null);
  const pick = surviving.find((c) => c.id === subject) ?? surviving[0];
  const id = pick?.id ?? subject ?? '';
  return { id, offset: pick?.after?.content.length ?? 0 };
}

function subjectId(op: Operation): string | undefined {
  const input = op.input as Partial<{ id: string; newId: string; sourceId: string; targetId: string }> | null;
  return input?.id ?? input?.targetId ?? undefined;
}
