import { describe, expect, it } from 'vitest';
import { createClock } from './clock';
import { entriesForAll, entriesForChanges, entriesForReplace, mergeEntry, sameTimes } from './outbox';
import { changedGroups, fromWire, GROUPS, mergeTimes, NO_TIMES, overlayPending, tombstone, toWire, type NodeFields, type WireNode } from './wire';

const base: NodeFields = {
  id: 'n1',
  parentId: 'p1',
  order: 'a0',
  content: 'text',
  note: 'note',
  collapsed: false,
  starredAt: null,
  completedAt: null,
  heading: null,
  color: null,
  createdAt: 100,
  updatedAt: 200,
  deletedAt: null,
};

describe('changedGroups', () => {
  it('reports a removed node as deleted and a new node as every group', () => {
    expect(changedGroups(base, null)).toEqual(['deleted']);
    expect(changedGroups(null, null)).toEqual(['deleted']);
    expect(changedGroups(null, base)).toEqual([...GROUPS]);
  });

  it('reports nothing when only updatedAt or createdAt differ', () => {
    expect(changedGroups(base, { ...base, updatedAt: 999, createdAt: 1 })).toEqual([]);
  });

  it('names exactly the group of each changed field', () => {
    expect(changedGroups(base, { ...base, content: 'x' })).toEqual(['content']);
    expect(changedGroups(base, { ...base, note: 'x' })).toEqual(['note']);
    expect(changedGroups(base, { ...base, parentId: null })).toEqual(['pos']);
    expect(changedGroups(base, { ...base, order: 'a1' })).toEqual(['pos']);
    expect(changedGroups(base, { ...base, collapsed: true })).toEqual(['collapsed']);
    expect(changedGroups(base, { ...base, starredAt: 5 })).toEqual(['starred']);
    expect(changedGroups(base, { ...base, completedAt: 5 })).toEqual(['completed']);
    expect(changedGroups(base, { ...base, heading: 2 })).toEqual(['format']);
    expect(changedGroups(base, { ...base, color: 'red' })).toEqual(['format']);
    expect(changedGroups(base, { ...base, deletedAt: 5 })).toEqual(['deleted']);
  });

  it('treats a missing starredAt as not starred', () => {
    const { starredAt: _, ...old } = base;
    expect(changedGroups(old, base)).toEqual([]);
    expect(changedGroups(old, { ...base, starredAt: 7 })).toEqual(['starred']);
  });

  it('treats a missing done, heading or color as none', () => {
    const { completedAt: _c, heading: _h, color: _k, ...old } = base;
    expect(changedGroups(old, base)).toEqual([]);
    expect(changedGroups(old, { ...base, completedAt: 7, color: 'blue' })).toEqual(['completed', 'format']);
  });

  it('lists several groups in GROUPS order', () => {
    const after = { ...base, content: 'x', note: 'y', order: 'b', collapsed: true, starredAt: 1, completedAt: 3, heading: 1, deletedAt: 2 };
    expect(changedGroups(base, after)).toEqual([...GROUPS]);
  });
});

describe('mergeTimes', () => {
  it('keeps the newest time of each group from either side', () => {
    expect(mergeTimes({ content: 5, note: 9 }, { content: 7, note: 3, pos: 1 })).toEqual({ content: 7, note: 9, pos: 1 });
  });

  it('ignores equal, zero and missing times on the right', () => {
    expect(mergeTimes({ content: 5 }, { content: 5 })).toEqual({ content: 5 });
    expect(mergeTimes({}, { content: 0 })).toEqual({});
    expect(mergeTimes({ note: 2 }, {})).toEqual({ note: 2 });
  });

  it('does not change its inputs', () => {
    const a = { content: 1 };
    mergeTimes(a, { content: 2 });
    expect(a).toEqual({ content: 1 });
  });
});

describe('toWire / fromWire / tombstone', () => {
  it('fills missing group times with 0 and a missing star, done, heading or color with null', () => {
    const { starredAt: _, completedAt: _c, heading: _h, color: _k, ...old } = base;
    expect(toWire(old, { content: 300 })).toEqual({
      id: 'n1',
      parentId: 'p1',
      order: 'a0',
      content: 'text',
      note: 'note',
      collapsed: false,
      starredAt: null,
      completedAt: null,
      heading: null,
      color: null,
      createdAt: 100,
      deletedAt: null,
      t: { ...NO_TIMES, content: 300 },
    });
  });

  it('does not send updatedAt; fromWire derives it from the newest group time', () => {
    const w = toWire({ ...base, starredAt: 42, completedAt: 43, heading: 3, color: 'green' }, { note: 250, pos: 400 });
    expect(w).not.toHaveProperty('updatedAt');
    expect(fromWire(w)).toEqual({ ...base, starredAt: 42, completedAt: 43, heading: 3, color: 'green', updatedAt: 400 });
  });

  it('uses createdAt as updatedAt when every group time is older', () => {
    const w = toWire({ ...base, createdAt: 500 }, { content: 10 });
    expect(fromWire(w).updatedAt).toBe(500);
  });

  it('reads a node from an old client without stars, done, headings or colors as having none', () => {
    const { starredAt: _, completedAt: _c, heading: _h, color: _k, ...w } = toWire(base, { content: 300 });
    const old = { ...w, t: { content: 300, note: 0, pos: 0, collapsed: 0, deleted: 0 } } as unknown as WireNode;
    expect(fromWire(old)).toEqual({ ...base, starredAt: null, completedAt: null, heading: null, color: null, updatedAt: 300 });
  });

  it('a tombstone carries only the deletion as news', () => {
    expect(tombstone('gone', 77)).toEqual({
      id: 'gone',
      parentId: null,
      order: 'a0',
      content: '',
      note: '',
      collapsed: false,
      starredAt: null,
      completedAt: null,
      heading: null,
      color: null,
      createdAt: 77,
      deletedAt: 77,
      t: { content: 0, note: 0, pos: 0, collapsed: 0, starred: 0, completed: 0, format: 0, deleted: 77 },
    });
  });
});

describe('overlayPending', () => {
  const remote: NodeFields = { ...base, content: 'remote', note: 'remote note', parentId: 'pr', order: 'r', collapsed: false, starredAt: null, deletedAt: null, updatedAt: 500 };
  const local: NodeFields = { ...base, content: 'local', note: 'local note', parentId: 'pl', order: 'l', collapsed: true, starredAt: 9, completedAt: 7, heading: 2, color: 'red', deletedAt: 8, updatedAt: 600 };
  const remoteTimes = { content: 50, note: 50, pos: 50, collapsed: 50, starred: 50, completed: 50, format: 50, deleted: 50 };

  it('returns the remote node when nothing is pending', () => {
    expect(overlayPending(remote, undefined, { content: 99 }, remoteTimes)).toBe(remote);
    expect(overlayPending(remote, local, undefined, remoteTimes)).toBe(remote);
  });

  it('keeps each local group that changed after the remote one', () => {
    const pending = { content: 60, note: 60, pos: 60, collapsed: 60, starred: 60, completed: 60, format: 60, deleted: 60 };
    expect(overlayPending(remote, local, pending, remoteTimes)).toEqual({ ...local, updatedAt: 600 });
  });

  it('keeps the remote group when the local change is older or equal', () => {
    const pending = { content: 50, note: 40 };
    expect(overlayPending(remote, local, pending, remoteTimes)).toEqual({ ...remote, updatedAt: 600 });
  });

  it('overlays only the newer groups', () => {
    const out = overlayPending(remote, local, { pos: 51, starred: 51 }, remoteTimes);
    expect(out).toEqual({ ...remote, parentId: 'pl', order: 'l', starredAt: 9, updatedAt: 600 });
    expect(overlayPending(remote, local, { content: 51 }, remoteTimes)).toEqual({ ...remote, content: 'local', updatedAt: 600 });
    expect(overlayPending(remote, local, { note: 51 }, remoteTimes)).toEqual({ ...remote, note: 'local note', updatedAt: 600 });
    expect(overlayPending(remote, local, { collapsed: 51 }, remoteTimes)).toEqual({ ...remote, collapsed: true, updatedAt: 600 });
    expect(overlayPending(remote, local, { deleted: 51 }, remoteTimes)).toEqual({ ...remote, deletedAt: 8, updatedAt: 600 });
    expect(overlayPending(remote, local, { completed: 51 }, remoteTimes)).toEqual({ ...remote, completedAt: 7, updatedAt: 600 });
    expect(overlayPending(remote, local, { format: 51 }, remoteTimes)).toEqual({ ...remote, heading: 2, color: 'red', updatedAt: 600 });
  });

  it('keeps the remote updatedAt when it is newer, and reads a missing local star as null', () => {
    const { starredAt: _, ...oldLocal } = local;
    const out = overlayPending({ ...remote, starredAt: 3, updatedAt: 900 }, oldLocal, { starred: 51 }, remoteTimes);
    expect(out.starredAt).toBeNull();
    expect(out.updatedAt).toBe(900);
  });

  it('reads a missing local done, heading or color as null', () => {
    const { completedAt: _c, heading: _h, color: _k, ...oldLocal } = local;
    const out = overlayPending({ ...remote, completedAt: 3, heading: 1, color: 'blue' }, oldLocal, { completed: 51, format: 51 }, remoteTimes);
    expect(out).toEqual({ ...remote, completedAt: null, heading: null, color: null, updatedAt: 600 });
  });

  it('does not change the remote node', () => {
    const copy = { ...remote };
    overlayPending(remote, local, { content: 99 }, remoteTimes);
    expect(remote).toEqual(copy);
  });
});

describe('outbox entries', () => {
  const node = { ...base, starredAt: null };

  it('stamps only the changed groups and skips changes that change nothing', () => {
    const entries = entriesForChanges(
      [
        { id: 'n1', before: node, after: { ...node, content: 'x', order: 'b' } },
        { id: 'n2', before: node, after: { ...node, updatedAt: 5 } },
        { id: 'n3', before: node, after: null },
      ],
      1000,
    );
    expect(entries).toEqual([
      { nodeId: 'n1', t: { content: 1000, pos: 1000 }, node: { ...node, content: 'x', order: 'b' } },
      { nodeId: 'n3', t: { deleted: 1000 }, node: null },
    ]);
  });

  it('uploads every group of every node at its last change', () => {
    expect(entriesForAll([{ ...node, updatedAt: 7 }])).toEqual([
      { nodeId: 'n1', t: { content: 7, note: 7, pos: 7, collapsed: 7, starred: 7, completed: 7, format: 7, deleted: 7 }, node: { ...node, updatedAt: 7 } },
    ]);
  });

  it('after a replace, sends every new node and deletes only the ids that are gone', () => {
    const a = { ...node, id: 'a' };
    const entries = entriesForReplace(['a', 'old'], [a], 50);
    expect(entries).toEqual([
      { nodeId: 'a', t: { content: 50, note: 50, pos: 50, collapsed: 50, starred: 50, completed: 50, format: 50, deleted: 50 }, node: a },
      { nodeId: 'old', t: { deleted: 50 }, node: null },
    ]);
  });

  it('merges entries: newest times, the latest snapshot, or the earlier one when the new entry has none', () => {
    const next = { nodeId: 'n1', t: { content: 9 }, node: { ...node, content: 'new' } };
    expect(mergeEntry(undefined, next)).toBe(next);
    const prev = { nodeId: 'n1', t: { content: 5, note: 6 }, node };
    expect(mergeEntry(prev, next)).toEqual({ nodeId: 'n1', t: { content: 9, note: 6 }, node: { ...node, content: 'new' } });
    expect(mergeEntry(prev, { nodeId: 'n1', t: { pos: 1 } })).toEqual({ nodeId: 'n1', t: { content: 5, note: 6, pos: 1 }, node });
    expect(mergeEntry(prev, { nodeId: 'n1', t: {}, node: null })).toEqual({ nodeId: 'n1', t: { content: 5, note: 6 }, node: null });
    expect(mergeEntry({ nodeId: 'n1', t: {} }, { nodeId: 'n1', t: {} })).not.toHaveProperty('node');
  });

  it('compares times treating a missing group as 0', () => {
    expect(sameTimes({ content: 1 }, { content: 1, note: 0 })).toBe(true);
    expect(sameTimes({ content: 1 }, { content: 2 })).toBe(false);
    expect(sameTimes({ deleted: 3 }, {})).toBe(false);
  });
});

describe('createClock', () => {
  it('follows the wall clock but never repeats or goes back', () => {
    let wall = 1000;
    const clock = createClock(() => wall);
    expect(clock.now()).toBe(1000);
    expect(clock.now()).toBe(1001);
    wall = 900;
    expect(clock.now()).toBe(1002);
    wall = 5000;
    expect(clock.now()).toBe(5000);
  });

  it('stays later than times seen from other devices, ignoring older and invalid ones', () => {
    const clock = createClock(() => 1000);
    clock.observe(2000);
    expect(clock.now()).toBe(2001);
    clock.observe(10);
    clock.observe(Number.NaN);
    clock.observe(Number.POSITIVE_INFINITY);
    expect(clock.now()).toBe(2002);
  });

  it('uses Date.now by default', () => {
    const before = Date.now();
    const t = createClock().now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});
