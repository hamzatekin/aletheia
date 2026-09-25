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
src/editor        Markdown dialect (markdown-it) and sanitized static rendering
src/tree-view     Virtualized outline, rows, bullets, breadcrumbs, zoom page
src/app           Bootstrap (load + first-run seed) and the engine context
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

## Rendering

`visibleRows(tree, rootId)` flattens the subtree under the zoom root, skipping
collapsed nodes. The store keeps a `structureVersion` that only bumps on
hierarchy, order, collapse or delete changes, so typing never recomputes the
flattening. The list is virtualized against the window with
`@tanstack/react-virtual`; each row subscribes to its own node only.

Routes: `/` is the top level, `/n/:id` zooms into a node (its content becomes
the title, its children the list). Breadcrumbs walk `parentId` upward.
`Ctrl/⌘+,` zooms out one level.

## Drag and drop

Drag by the bullet (`@atlaskit/pragmatic-drag-and-drop` with the tree-item
hitbox). The top quarter of a row drops above it, the bottom quarter below;
the middle (or the whole lower part of an expanded row) drops as its first
child. Below the last sibling of a group the horizontal pointer position
picks the depth to outdent to; `resolveInstruction` in `tree-view/dnd.ts`
maps every hitbox instruction to a `moveNode` command and to the indicator
line, and clamps outdent depth so the line always shows where the node will
actually land. Dropping a node onto itself or a descendant is refused.

## Scripts

```
pnpm dev        start the app
pnpm test       run unit tests
pnpm typecheck  tsc
pnpm build      production build
```
