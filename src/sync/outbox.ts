import type { Node, NodeChange } from '@/model';
import { changedGroups, GROUPS, mergeTimes, type GroupTimes } from './wire';

/** A node with changes not yet uploaded, and when each changed group last changed. */
export interface OutboxEntry {
  nodeId: string;
  t: Partial<GroupTimes>;
}

/** Outbox entries for one operation's changes. */
export function entriesForChanges(changes: readonly NodeChange[], at: number): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const c of changes) {
    const groups = changedGroups(c.before, c.after);
    if (groups.length === 0) continue;
    const t: Partial<GroupTimes> = {};
    for (const g of groups) t[g] = at;
    out.push({ nodeId: c.id, t });
  }
  return out;
}

/** Outbox entries that upload every group of these nodes, stamped with each node's last change. */
export function entriesForAll(nodes: Iterable<Node>): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const n of nodes) {
    const t: Partial<GroupTimes> = {};
    for (const g of GROUPS) t[g] = n.updatedAt;
    out.push({ nodeId: n.id, t });
  }
  return out;
}

/** Entries after a wholesale replace: every new node, plus deletions for nodes that are gone. */
export function entriesForReplace(oldIds: Iterable<string>, nodes: readonly Node[], at: number): OutboxEntry[] {
  const keep = new Set(nodes.map((n) => n.id));
  const out: OutboxEntry[] = nodes.map((n) => ({ nodeId: n.id, t: { content: at, note: at, pos: at, collapsed: at, deleted: at } }));
  for (const id of oldIds) if (!keep.has(id)) out.push({ nodeId: id, t: { deleted: at } });
  return out;
}

export function mergeEntry(prev: OutboxEntry | undefined, next: OutboxEntry): OutboxEntry {
  return prev ? { nodeId: next.nodeId, t: mergeTimes(prev.t, next.t) } : next;
}

export function sameTimes(a: Partial<GroupTimes>, b: Partial<GroupTimes>): boolean {
  return GROUPS.every((g) => (a[g] ?? 0) === (b[g] ?? 0));
}
