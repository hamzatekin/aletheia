# Aletheia

A minimal, keyboard-first outliner. One infinite hierarchical list; every line is a
node with unlimited children. The tree is the source of truth; Markdown is the
content and export format, never the storage format for hierarchy.

## Stack

Vite · React · TypeScript (strict) · Tailwind · Zustand · Dexie · Vitest

## Layout

```
src/model         Node type, IDs (UUIDv7), sibling order (fractional indexing),
                  pure tree helpers, Operation / DirtyNode types, seed tree
src/store         Zustand store: Map<id, Node> + childrenByParent index
src/persistence   Repository interface, Dexie implementation, in-memory implementation
src/commands      Typed commands, the engine (apply → persist → op log → undo/redo)
src/editor        (step 3)
src/tree-view     (step 2)
src/search        (step 5)
src/io            (step 5)
```

## How a command runs

1. `computeEffect(tree, command)` is pure. It returns either a `Rejection`
   (e.g. indenting a first child, moving a node into its own descendant) or an
   `Effect`: a list of `NodeChange { id, before, after }`, the
   `affectedNodeIds`, and an optional caret hint for the view.
2. The engine applies the changes to the store synchronously, so the UI never
   waits on IndexedDB.
3. The same batch (node upserts/removals, the `Operation` record, and the
   affected ids for the `dirtyNodes` table) is written through an ordered
   write queue into the repository in one transaction.
4. The operation goes on the undo stack. Undo swaps `before`/`after` for every
   change and commits that as its own `undo` operation (redo likewise), so the
   operation log is a complete history and undo of a `createNode` physically
   removes the node again.

Soft delete: `deleteSubtree` stamps the root and every live descendant with the
same `deletedAt`. `restore` brings back exactly that set, leaving descendants
deleted earlier in place.

## Scripts

```
pnpm dev        start the app
pnpm test       run unit tests
pnpm typecheck  tsc
pnpm build      production build
```
