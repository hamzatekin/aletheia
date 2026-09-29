# Aletheia: notes for agents

A keyboard-first outliner in the style of WorkFlowy and Dynalist. Notes live
in the browser (IndexedDB); an optional sync API runs on the same Cloudflare
Worker. Live at https://aletheia.hmztkn.workers.dev/. Personal project with
one user, so prefer simple, free-tier designs without accounts.

README.md explains the design in depth (commands, rendering, drag and drop,
sync, PWA, deploy). This file is the short version: where things are and how
to change them safely.

## Commands

```
pnpm install
pnpm check      typecheck + unit tests + knip; run before every push
pnpm test       unit tests only (Vitest, src/**/*.test.ts and worker/**/*.test.ts)
pnpm test:e2e   browser tests (Playwright, starts the dev server itself)
pnpm build      production build (tsc -b, then vite build)
pnpm dev        dev server on :5173
```

- In the cloud container, run e2e with
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e`
  (the bundled Playwright browser is not installed there).
- Sync API locally: `pnpm build && npx wrangler dev` (serves on :8787; `pnpm dev`
  proxies `/api` to it).
- There is no CI on GitHub. The "Workers Builds: aletheia" check fails
  instantly on every PR and is not caused by the code; don't block on it.
  Production deploys from `main`.

## Where things are

```
src/main.tsx          wires everything: repository, engine, stores, session, search, sync
src/App.tsx           routes: /, /n/:id (zoom), /share, /capture
src/model/            Node type, ids, order keys, pure tree helpers, seed tree, tree repair
src/commands/         typed commands: pure effect functions + the engine (undo/redo, persist)
src/persistence/      Repository interface; Dexie (IndexedDB) and in-memory implementations
src/store/            zustand stores: tree (nodes), ui (focus, selection, menus), settings, note prefs
src/editor/           the single Tiptap editor (session.ts), keymap, Markdown dialect, slash menu
src/tree-view/        the outline page, rows, sidebar, mobile toolbar, drag and drop
src/tree-view/actions/  everything the page does, one file per group (see index.ts)
src/search/           Ctrl+K palette (MiniSearch) and Ctrl+F in-place filter
src/io/               Markdown / OPML / JSON import and export, clipboard, WorkFlowy and terminal paste
src/sync/             opt-in sync client: wire format, outbox, service, tabs, clock
src/settings/         Settings panel (appearance, sync)
src/ai/               AI actions (Suggest title) via the Worker's proxy to the Claude relay
src/related/          Related panel: rows elsewhere about an item (text matches, then AI), chat about it
src/help/             tutorial dialog (lists every shortcut)
src/app/              bootstrap, engine context, capture route (share target)
worker/               Cloudflare Worker: only /api/* runs it; sync API on D1, AI proxy (ai.ts)
pwa/                  service worker and the Vite plugin that builds it
e2e/                  Playwright specs; helpers.ts drives the app via window.__aletheia
```

## How data flows

1. UI code never edits nodes directly. It calls `engine.execute(command)` or
   `engine.batch(items, type)`.
2. `computeEffect` (commands/dispatch.ts) is pure: it returns node changes or a
   rejection. The engine applies them to the tree store synchronously, then
   writes them to the repository through an ordered queue, and pushes an undo
   entry.
3. Rows subscribe to their own node (`useNode`), so typing re-renders one row.
4. Search and sync listen with `engine.onOperation`.
5. UI state that is not a node (focus, caret, selection, open menus, filter)
   lives in the ui store, not in React state, so actions can read it outside
   components.

The editor is one Tiptap instance (`EditorSession`) that moves to whichever
row is focused. Call `session.flush()` before anything that reads or changes
the tree while a row may be mid-edit; the existing actions show the pattern.

## Recipes

- **New command**: add it to the `Command` union in `commands/types.ts`, write a
  pure function in the matching `*-commands.ts`, route it in `dispatch.ts`, and
  test it in `commands.test.ts` with the `fixture` helper from `src/test/helpers.ts`.
- **New page action or shortcut**: add it to the right file in
  `tree-view/actions/`, expose it through `OutlineActions` in `index.ts` if
  components need it, and list the shortcut in `help/TutorialDialog.tsx`.
- **New slash command**: add an entry in `editor/default-slash-commands.ts`.
  The "/" menu only inserts into the text being edited (formats, note blocks,
  AI). Node actions go in `tree-view/NodeMenu.tsx`; app-wide ones (import,
  export) in `settings/DataSection.tsx`.
- **New synced node field**: follow `starredAt`. Add it to `Node` and
  `NodeFields`, give it a group in `sync/wire.ts` (`GROUPS`), handle it in
  `sync/outbox.ts` and `engine.ts` (`sameNode`), and add a D1 column plus its
  migration in `worker/sync.ts` (`ensureSchema`). Old clients without the field
  must still be accepted.
- **New AI action**: prompt builder beside `ai/suggest-title.ts`, a method on
  the service in `ai/service.ts`, then entries in `ai/slash-commands.ts` and
  `tree-view/NodeMenu.tsx`. The Worker proxy (`worker/ai.ts`) only answers
  devices with a sync key and needs the `CLAUDE_RELAY_TOKEN` secret; never
  commit the token.
- **New appearance setting**: `store/settings-store.ts` (saved in localStorage,
  per device), UI in `settings/SettingsPanel.tsx`.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Import across folders with `@/`.
- Match the surrounding style: 2 spaces, single quotes, semicolons, long lines
  are fine. No formatter or linter is configured; `pnpm knip` flags unused
  files, exports and dependencies.
- Comments say why, briefly. Most functions have a one-line doc comment.
- Tests sit next to the code (`foo.test.ts`). User-visible behavior gets an
  e2e spec in `e2e/`; the tests read the app through `window.__aletheia`
  (dev builds only) and `data-testid` attributes.
- For any feature, check how WorkFlowy and Dynalist do it (desktop and phone)
  and follow them. The owner uses the app on desktop and on an Android phone,
  so check touch layouts too (`useCoarsePointer`).
- User-facing text is plain and short.

## Gotchas

- Don't add a `public/_redirects` catch-all. Workers rejects it as a redirect
  loop; SPA routing comes from `not_found_handling` in `wrangler.jsonc`.
- Changing the Dexie schema (`persistence/db.ts`) needs a new version, and an
  upgrade closes the database in every other open tab. Avoid it unless the
  data model needs it.
- Deleting nodes is a soft delete (`deletedAt`); the tree store's child
  index skips deleted nodes. Only undoing a creation removes a node physically.
- Sibling order uses fractional index keys (`model/order.ts`); equal keys sort
  by id.
