import type { Node, NodeChange } from '@/model';
import { changedGroups, GROUPS, mergeTimes, type GroupTimes } from './wire';

/** A node with changes not yet uploaded, and when each changed group last changed. */
export interface OutboxEntry {
  nodeId: string;
  t: Partial<GroupTimes>;
  /**
   * The node as this browser last saved it (null = removed). Uploads send this
   * copy rather than a tab's in-memory tree, which may be out of date. Absent
   * in entries written before snapshots existed.
   */
  node?: Node | null;
}

/** Outbox entries for one operation's changes. */
export function entriesForChanges(changes: readonly NodeChange[], at: number): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const c of changes) {
    const groups = changedGroups(c.before, c.after);
    if (groups.length === 0) continue;
    const t: Partial<GroupTimes> = {};
    for (const g of groups) t[g] = at;
    out.push({ nodeId: c.id, t, node: c.after });
  }
  return out;
}

/** Outbox entries that upload every group of these nodes, stamped with each node's last change. */
export function entriesForAll(nodes: Iterable<Node>): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const n of nodes) out.push({ nodeId: n.id, t: allGroups(n.updatedAt), node: n });
  return out;
}

/** Every group stamped with the same time. */
function allGroups(at: number): GroupTimes {
  return Object.fromEntries(GROUPS.map((g) => [g, at])) as GroupTimes;
}

/** Entries after a wholesale replace: every new node, plus deletions for nodes that are gone. */
export function entriesForReplace(oldIds: Iterable<string>, nodes: readonly Node[], at: number): OutboxEntry[] {
  const keep = new Set(nodes.map((n) => n.id));
  const out: OutboxEntry[] = nodes.map((n) => ({ nodeId: n.id, t: allGroups(at), node: n }));
  for (const id of oldIds) if (!keep.has(id)) out.push({ nodeId: id, t: { deleted: at }, node: null });
  return out;
}

export function mergeEntry(prev: OutboxEntry | undefined, next: OutboxEntry): OutboxEntry {
  if (!prev) return next;
  const merged: OutboxEntry = { nodeId: next.nodeId, t: mergeTimes(prev.t, next.t) };
  const node = next.node !== undefined ? next.node : prev.node;
  if (node !== undefined) merged.node = node;
  return merged;
}

export function sameTimes(a: Partial<GroupTimes>, b: Partial<GroupTimes>): boolean {
  return GROUPS.every((g) => (a[g] ?? 0) === (b[g] ?? 0));
}
