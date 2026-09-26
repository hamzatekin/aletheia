/**
 * What devices and the sync server exchange. Shared by the app and the Worker,
 * so it imports nothing.
 *
 * A node's fields are merged in groups. Each group carries the time it was
 * last changed, and the newest change to each group wins, so moving a node on
 * one device and editing its text on another both survive.
 */

export const GROUPS = ['content', 'note', 'pos', 'collapsed', 'deleted'] as const;
export type Group = (typeof GROUPS)[number];
export type GroupTimes = Record<Group, number>;

/** Structural subset of the app's `Node` (kept here so the Worker needs nothing else). */
export interface NodeFields {
  id: string;
  parentId: string | null;
  order: string;
  content: string;
  note: string;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WireNode {
  id: string;
  parentId: string | null;
  order: string;
  content: string;
  note: string;
  collapsed: boolean;
  createdAt: number;
  deletedAt: number | null;
  /** When each group last changed. 0 = unchanged here (never wins). */
  t: GroupTimes;
}

/** A node as the server stores it, with its place in the change feed. */
export interface ServerNode extends WireNode {
  seq: number;
}

export interface PushRequest {
  nodes: WireNode[];
}

export interface PullResponse {
  nodes: ServerNode[];
  /** Pass back as `since` to continue. */
  cursor: number;
  more: boolean;
}

export const NO_TIMES: GroupTimes = { content: 0, note: 0, pos: 0, collapsed: 0, deleted: 0 };

/** The groups that differ between two versions of a node. */
export function changedGroups(before: NodeFields | null, after: NodeFields | null): Group[] {
  if (!after) return ['deleted'];
  if (!before) return [...GROUPS];
  const out: Group[] = [];
  if (before.content !== after.content) out.push('content');
  if (before.note !== after.note) out.push('note');
  if (before.parentId !== after.parentId || before.order !== after.order) out.push('pos');
  if (before.collapsed !== after.collapsed) out.push('collapsed');
  if (before.deletedAt !== after.deletedAt) out.push('deleted');
  return out;
}

/** Newest time per group. */
export function mergeTimes(a: Partial<GroupTimes>, b: Partial<GroupTimes>): Partial<GroupTimes> {
  const out: Partial<GroupTimes> = { ...a };
  for (const g of GROUPS) {
    const t = b[g];
    if (t !== undefined && t > (out[g] ?? 0)) out[g] = t;
  }
  return out;
}

export function toWire(node: NodeFields, times: Partial<GroupTimes>): WireNode {
  return {
    id: node.id,
    parentId: node.parentId,
    order: node.order,
    content: node.content,
    note: node.note,
    collapsed: node.collapsed,
    createdAt: node.createdAt,
    deletedAt: node.deletedAt,
    t: { ...NO_TIMES, ...times },
  };
}

/** A node that was removed outright on this device: only its deletion is news. */
export function tombstone(id: string, at: number): WireNode {
  return {
    id,
    parentId: null,
    order: 'a0',
    content: '',
    note: '',
    collapsed: false,
    createdAt: at,
    deletedAt: at,
    t: { ...NO_TIMES, deleted: at },
  };
}

export function fromWire(w: WireNode): NodeFields {
  return {
    id: w.id,
    parentId: w.parentId,
    order: w.order,
    content: w.content,
    note: w.note,
    collapsed: w.collapsed,
    createdAt: w.createdAt,
    updatedAt: Math.max(w.createdAt, ...GROUPS.map((g) => w.t[g])),
    deletedAt: w.deletedAt,
  };
}

/**
 * Lay the local, not yet uploaded groups over a node from the server, where
 * the local change is newer. Keeps edits made while a sync was in flight.
 */
export function overlayPending(remote: NodeFields, local: NodeFields | undefined, pending: Partial<GroupTimes> | undefined, remoteTimes: GroupTimes): NodeFields {
  if (!local || !pending) return remote;
  const out = { ...remote };
  const newer = (g: Group) => (pending[g] ?? 0) > remoteTimes[g];
  if (newer('content')) out.content = local.content;
  if (newer('note')) out.note = local.note;
  if (newer('pos')) {
    out.parentId = local.parentId;
    out.order = local.order;
  }
  if (newer('collapsed')) out.collapsed = local.collapsed;
  if (newer('deleted')) out.deletedAt = local.deletedAt;
  out.updatedAt = Math.max(out.updatedAt, local.updatedAt);
  return out;
}
