# Aletheia: notes for agents

A keyboard-first outliner in the style of WorkFlowy and Dynalist. Notes live
in the browser (IndexedDB); an optional sync API runs on the same Cloudflare
Worker. Live at https://aletheia.hamzatekin.dev/ (custom domain; the old
https://aletheia.hmztkn.workers.dev/ still serves the same Worker). Personal project with
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
pnpm mutate     mutation testing (StrykerJS) of the pure logic; see "Tests" below
pnpm build      production build (tsc -b, then vite build)
pnpm dev        dev server on :5173
```

- Claude Code cloud sessions run `.claude/hooks/session-start.sh`, which
  installs dependencies and sets `CHROMIUM_PATH` to the container's Chromium
  (the browser Playwright wants is not installed there). If `CHROMIUM_PATH`
  is unset, use
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e`.
- `pnpm test:e2e e2e/foo.spec.ts` runs one spec; add `--repeat-each 3` to
  check whether a failure is a flake.
- Sync API locally: `pnpm build && npx wrangler dev` (serves on :8787; `pnpm dev`
  proxies `/api` to it).
- There is no CI on GitHub. The "Workers Builds: aletheia" check fails
  instantly on every PR and is not caused by the code; don't block on it.
  Production deploys from `main`. Cloudflare sometimes misses a push to
  `main` (no "Workers Builds" run on that commit at all, and the live
  `assets/index-*.js` still matches the previous commit's build); the next
  push to `main` deploys it.

## Where things are

```
src/main.tsx          wires everything: repository, engine, stores, session, search, sync, AI, agent
src/App.tsx           routes: /, /n/:id (zoom), /share, /capture, /p/:id (a page sent from Claude Code);
                      all of them again under /sandbox (a blank outline in its own database that never syncs)
src/model/            Node type, ids, order keys, pure tree helpers, seed tree, tree repair
src/commands/         typed commands: pure effect functions + the engine (undo/redo, persist)
src/persistence/      Repository interface; Dexie (IndexedDB) and in-memory implementations
src/store/            zustand stores: tree (nodes), ui (focus, selection, menus), settings, note prefs
src/editor/           the single Tiptap editor (session.ts), keymap, Markdown dialect, slash menu, note editors
                      (notes render Markdown with task lists, images and bare links: markdown.ts,
                      sanitized in render.ts; the note editor saves untouched blocks verbatim, note-source.ts)
src/tree-view/        the outline page: rows, bullets, node menu, breadcrumbs, top bar, sidebars,
                      mobile toolbar, drag and drop; layout.ts has row geometry and long-press timing
src/tree-view/actions/  everything the page does, one file per group (see index.ts)
src/ui/               small shared UI: media queries (isWide, useCoarsePointer, isMac), hooks
                      (useEscToClose, useTick, useKeyboardInset), holdKeyboard, Spinner, Button, ago()
src/search/           Ctrl+K palette (MiniSearch) and Ctrl+F in-place filter
src/io/               Markdown / OPML / JSON import and export, clipboard, WorkFlowy and terminal paste
src/sync/             opt-in sync client: wire format, outbox, service, tabs, clock, browser triggers
src/settings/         Settings panel (appearance, sync, import/export), sync status at the top right
src/ai/               AI actions (Suggest title) via the Worker's proxy to the Claude relay
src/agent/            Ask AI: one chat for the app (sparkle button, right panel). AI searches and opens rows
                      (run on the device), then answers and makes changes (create, move, edit, star; no
                      delete) as one batch with its own Undo; questions start from the row you're on;
                      a personal assistant with a memory: rows under the "AI memory" row (memory.ts)
src/help/             tutorial dialog (lists every shortcut)
src/app/              bootstrap, engine context, /share and /capture (share target, Add to Inbox)
worker/               Cloudflare Worker: only /api/* runs it; sync API on D1 (sync.ts), AI proxy (ai.ts: /v1/complete,
                      or the relay's /v1/chat session endpoint when the app sends `session`),
                      capture from Claude Code (capture.ts, pages.ts; the skill is public/claude-code/SKILL.md)
                      feed for pergent (feed.ts: read-only, FEED_TOKEN secret, FEED_PILES allow-list)
pwa/                  service worker and the Vite plugin that builds it
e2e/                  Playwright specs; helpers.ts drives the app via window.__aletheia
.claude/              cloud session hook (installs deps, sets CHROMIUM_PATH)
patches/              fix for Stryker's Vitest runner, applied by `pnpm mutate` (see Gotchas)
stryker.config.mjs    mutation testing scope and thresholds
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
- **New synced node field**: follow `starredAt` (grep for it). Add it to
  `Node` and `NodeFields`; give it a group in `sync/wire.ts` (`GROUPS`) and
  handle it in `changedGroups`, `toWire`, `tombstone`, `fromWire` and
  `overlayPending`; compare it in `engine.ts` (`sameNode`). In
  `worker/sync.ts` add the columns to the schema and `ADDED_COLUMNS` (for
  existing databases), `UPSERT`, `GROUP_COLUMNS`, the pull row mapping and
  push validation. Old clients without the field must still be accepted.
- **New AI action**: prompt builder beside `ai/suggest-title.ts`, a method on
  the service in `ai/service.ts`, then entries in `ai/slash-commands.ts` and
  `tree-view/NodeMenu.tsx`. The Worker proxy (`worker/ai.ts`) only answers
  devices with a sync key and needs the `CLAUDE_RELAY_TOKEN` secret; never
  commit the token.
- **New appearance setting**: in `store/settings-store.ts` (saved in
  localStorage, per device) add it to `Settings` and `DEFAULT_SETTINGS`, to
  `sanitize` (it drops unknown keys, so a setting missing there never
  persists), to `LIMITS` if numeric, and apply it in `applySettings`. UI in
  `settings/SettingsPanel.tsx`.
- **Shared UI bit** (a media query, a small hook, a widget used by more than
  one folder): put it in `src/ui/` rather than importing across feature
  folders.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Import across folders with `@/`.
- Match the surrounding style: 2 spaces, single quotes, semicolons, long lines
  are fine. No formatter or linter is configured; `pnpm knip` flags unused
  files, exports and dependencies.
- Comments say why, briefly. Most functions have a one-line doc comment.
- Tests sit next to the code (`foo.test.ts`). User-visible behavior gets an
  e2e spec in `e2e/`; the tests read the app through `window.__aletheia`
  (dev builds only) and `data-testid` attributes. Reuse `e2e/helpers.ts`
  (`gotoHome`, `row`, `edit`, `nodeByText`, `openNodeMenu`, `reloadApp`,
  `syncOn`, `longPress`, `dragBullet`, ...) before writing new setup code.
- For any feature, check how WorkFlowy and Dynalist do it (desktop and phone)
  and follow them. The owner uses the app on desktop and on an Android phone,
  so check touch layouts too (`useCoarsePointer`).
- User-facing text is plain and short.

## Tests

Tests are the spec. Agents tend to make a red test green by bending the test;
don't.

- When a test fails, assume the code is wrong. Fix the code, not the test.
- Never weaken an existing test to get it passing: don't change an expected
  value, loosen a matcher (`toEqual` to `toMatchObject`, `toBe(3)` to
  `toBeGreaterThan(0)`, exact text to `toContain`), delete an assertion or a
  test, add `.skip`/`.only`/`.todo`/`.fails`, wrap it in `try`, or raise a
  timeout to hide a hang. (A stray `.only` already fails the run.)
- Changing what a test expects is only right when the user asked for that
  behavior change. Then change it in the same commit as the code, and list
  every changed assertion and why in the PR description. If unsure, ask.
- New tests assert exact results (whole objects, exact strings, exact order),
  so they fail when the behavior they name breaks. Test through the public
  function, not its internals.
- `pnpm mutate` runs StrykerJS on the pure logic listed in
  `stryker.config.mjs` (model, commands, search, import/export, the sync
  client and the Worker's sync API). It changes the code in small ways and
  checks that some test fails each time. A surviving mutant is a behavior no
  test pins down. After changing code in that scope, run it and kill new
  survivors with tests. Runs are incremental (only what changed is retested,
  under a minute); a full run (`pnpm mutate --force`) takes about ten
  minutes, and is the one to quote a score from, since incremental runs can
  keep stale results for module-level constants. The run
  fails below the `break` threshold (85%); don't lower it. Don't add
  `// Stryker disable` comments except for a mutant that cannot change
  behavior (an equivalent mutant), with the reason on the same line. The
  report is in `reports/mutation/index.html`.

## Gotchas

- Don't add a `public/_redirects` catch-all. Workers rejects it as a redirect
  loop; SPA routing comes from `not_found_handling` in `wrangler.jsonc`.
- Changing the Dexie schema (`persistence/db.ts`) needs a new version, and an
  upgrade closes the database in every other open tab. Avoid it unless the
  data model needs it.
- The sandbox (`src/app/sandbox.ts`) is decided once per page load from the
  URL (`inSandbox`). Code that touches the database, the sync key or the tabs
  channel must keep the two apart: the sandbox has no `SyncService`
  (`sync` is undefined) and borrows the real key only for AI.
- Deleting nodes is a soft delete (`deletedAt`); the tree store's child
  index skips deleted nodes. Only undoing a creation removes a node physically.
- Sibling order uses fractional index keys (`model/order.ts`); equal keys sort
  by id.
- Phones open the keyboard only for a field focused during the tap itself.
  When a tap leads to an editor that mounts later (after a navigation, like
  the + button's /capture), call `holdKeyboard()` (`src/ui/keyboard.ts`) in the
  tap handler; the editor takes the focus over and the keyboard stays up. A
  page opened with no tap (the app icon's shortcut) can't open it.
- `pnpm build` prints two harmless warnings: Lightning CSS doesn't know
  `::highlight(search)` (the CSS Custom Highlight API, used by Ctrl+F), and the
  main chunk is over 500 kB.
- `@stryker-mutator/vitest-runner` 10.0.0 needs a fix for Vitest 5, which
  matches test names as "suite > test"; without it every mutant runs zero
  tests and "survives". `pnpm mutate` applies it first
  (`patches/stryker-runner.mjs` edits node_modules). When upgrading the
  runner, drop it if the new version handles this (a report where nearly
  everything survives with 0 tests means it doesn't).
- Don't add a `pnpm-workspace.yaml` or `pnpm patch`/`patchedDependencies`.
  Cloudflare's build installs with an older pnpm that rejects a workspace
  file without `packages` and pnpm 10's patch hashes, and production
  deploys then fail at `pnpm install`.
- Stryker can't use TypeScript 7's tsconfig API, so `tsconfigFile` is empty
  in `stryker.config.mjs`; there is no TypeScript checker plugin either.
- The e2e test "a tap outside the menu only closes it" (`e2e/mobile.spec.ts`)
  sometimes fails when the whole suite runs in parallel and passes on a
  re-run of that file.
