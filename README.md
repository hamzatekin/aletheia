# Aletheia

Working on the code (or an AI agent)? Start with [CLAUDE.md](CLAUDE.md).

A minimal, keyboard-first outliner. One infinite hierarchical list; every line is a
node with unlimited children. The tree is the source of truth; Markdown is the
content and export format, never the storage format for hierarchy.

## Stack

Vite · React · TypeScript (strict) · Tailwind · Zustand · Dexie · Vitest

## Layout

```
src/model         Node type, IDs (UUIDv7), sibling order (fractional indexing),
                  pure tree helpers, Operation type, seed tree, tree repair
src/store         Zustand stores: the tree (Map<id, Node> + childrenByParent index),
                  UI state (focus, selection, menus), appearance settings, note prefs
src/persistence   Repository interface, Dexie implementation, in-memory implementation
src/commands      Typed commands, the engine (apply → persist → op log → undo/redo)
src/editor        The single Tiptap editor session, outliner keymap, slash menu, note
                  editors, GitHub Markdown (markdown-it) and sanitized static rendering;
                  math is typeset by KaTeX, loaded only when a note has math
src/tree-view     Virtualized outline, rows, bullets, breadcrumbs, zoom page;
                  actions/ holds what the page does, one file per group
src/ui            Small shared UI: media queries, hooks, spinner, buttons
src/app           Bootstrap (load + first-run seed), the engine context, and the
                  /share and /capture routes (Android share target, Add to Inbox)
src/search        MiniSearch index kept current from operations; Ctrl/⌘+K palette;
                  Ctrl/⌘+F in-place filter
src/io            Markdown / OPML / JSON export and import, clipboard, WorkFlowy and
                  terminal paste, file helpers
src/settings      Settings panel (appearance, sync, import & export), sync status
src/help          Tutorial dialog
src/sync          Opt-in sync: wire format, outbox, sync service, browser triggers
src/ai            AI actions (Suggest title) through the Worker's relay proxy
src/related       Related panel: what else is about an item, and a chat about it
worker            Cloudflare Worker: the sync API on D1 and the AI proxy (only `/api/*` runs it)
pwa               Service worker and the Vite plugin that builds it
e2e               Playwright specs
```

## How a command runs

1. `computeEffect(tree, command)` is pure. It returns either a `Rejection`
   (e.g. indenting a first child, moving a node into its own descendant) or an
   `Effect`: a list of `NodeChange { id, before, after }`, the
   `affectedNodeIds`, and an optional caret hint for the view.
2. The engine applies the changes to the store synchronously, so the UI never
   waits on IndexedDB.
3. The same batch (node upserts/removals and the `Operation` record) is
   written through an ordered write queue into the repository in one
   transaction.
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
the title, its children the list). `/share` (Android's share sheet) and
`/capture` (the Add to Inbox shortcut, the + buttons and `Ctrl/⌘+Alt+N`) put a
new item at the top of the Inbox; `/capture` names it with the date and time,
zooms into it and opens its note. Breadcrumbs walk `parentId` upward.
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

## Search, import/export, slash menu

`SearchIndex` indexes plain text of content and note for live nodes and
applies every engine operation incrementally. `Ctrl/⌘+K` opens the palette;
choosing a hit expands collapsed ancestors, zooms to the parent and focuses
the node.

Typing `/` in a node, or in a note in the rendered editor, opens the slash
menu, backed by `registerSlashCommand` in `editor/slash-registry.ts`. Like
WorkFlowy's, it only inserts into the text being edited: text formats (bold,
italic, strikethrough, inline code, link) everywhere, block formats (headings,
lists, checklist, quote, code block, table, divider) in notes, and AI actions. A command
says where it is offered (`fields`) and receives the editor it was typed in,
the field and the node. Actions on a node live in its menu (the ≡ grip, or a
long press on the bullet on touch screens, where a tap zooms in as everywhere
else); app-wide ones live in Settings.

Settings → Import & export: import Markdown or OPML as one new node at the
top of Home, named after the file and the date, with the file's items inside
it (one undo step); download everything as nested Markdown bullets (`content`
as bullet text, `note` as an indented paragraph beneath), as OPML with
`_note`, or the whole node table as JSON; restore a JSON backup. Pasting
multi-line text into a node creates one node per line, nested by indentation.

## Sync (opt-in)

Off by default; notes stay in the browser. Settings → Sync → **Turn on sync**
creates a random sync key, uploads this browser's notes, and shows a link
(`https://host/#sync=KEY`). Opening the link on another device offers to use
the synced notes (replacing that browser's notes) or merge its notes in. The
key sits in the URL fragment, which browsers never send to a server; the
server stores only its SHA-256. Anyone with the link can read and edit the
notes.

- **Local-first.** Edits apply and persist locally as before. While sync is
  on, `DexieRepository.commit` also records which field groups of which nodes
  changed in an `outbox` table, in the same transaction.
- **Sync run** (on start, 2s after edits, when the tab is shown or hidden,
  when back online, every 30s while visible): upload the outbox, download
  everything changed since the saved cursor in pages, merge, repair.
- **Merge.** Each node is merged in field groups (text, note, position,
  collapsed, starred, deleted), each with its own last-changed time; the newest change
  per group wins, on the server (`worker/sync.ts`, one SQL upsert) and on
  download (local changes not yet uploaded are kept). Moving a node on one
  device and editing it on another both survive; editing the same text on
  both keeps the later edit.
- **Repair** (`model/repair.ts`) after each download: a live node under a
  deleted parent brings the parent back; crossed moves that form a cycle move
  the cycle's smallest id to the top level; nodes with a missing parent move
  to the top level. Siblings with equal order keys sort by id.
- **Server.** `SYNC_MAX_SPACES` (default 1) caps how many sync keys the
  deployment accepts, so the first device to turn sync on owns a personal
  deployment. The Worker creates its tables on first use.

Local development: `pnpm build && npx wrangler dev` serves the app and the
API with a local D1 on :8787 (`pnpm dev` proxies `/api` to it). Reset local
sync data with `npx wrangler d1 execute aletheia-sync --local --command "DELETE FROM spaces; DELETE FROM nodes;"`.

## Claude Code: /aletheia

A Claude Code skill saves an answer into the outline: `/aletheia [title]` adds
an item under **Work › 14 Oct** (today, in the computer's time zone) with the
answer as its note, in Markdown. Work and the date are made when missing; a
new date goes at the top of Work, and items go at the end of their date.

- **Setup** (once per computer, sync must be on): Settings → Sync → Claude
  Code → **Set up Claude Code** shows a shell command. It writes
  `~/.config/aletheia/capture.curlrc` (the address, a capture key and the
  time zone, readable only by the user) and downloads the skill from
  `/claude-code/SKILL.md` (`public/claude-code/SKILL.md`) to
  `~/.claude/skills/aletheia/`.
- **Capture key.** `POST /api/sync/capture-key` (with the sync key) makes a
  key that can only add items, so the computer never holds the sync key.
  The server keeps its SHA-256; making a new one turns the old one off.
- **`POST /api/capture`** (`worker/capture.ts`) takes `title`, `note`,
  `under` (default `Work`), `date` and `tz` as JSON or form fields, finds the
  section (top level first, then the shallowest) and the date (made this
  year), writes the new nodes into the sync space, and answers
  `{ id, url, path }`. Devices see the item on their next sync.
- **Pages.** A capture can carry `page`, one HTML page (a work report with
  Mermaid flowcharts and charts, say; ask for "/aletheia with page"). The
  Worker stores it in D1 (`worker/pages.ts`) and the note starts with a link
  to `/p/<id>`. That app route (`src/app/PageRoute.tsx`) fetches it from
  `GET /api/pages/<id>` with the sync key, so only the owner's synced devices
  can open it, and shows it in an iframe sandboxed without
  `allow-same-origin`: its scripts run, but can't reach the app's storage or
  the sync key.

## AI (optional)

`POST /api/ai/complete` (`worker/ai.ts`) forwards `{ prompt }` to a Claude
relay (`CLAUDE_RELAY_URL`, default `https://ai.hamzatekin.dev/v1/complete`)
with the `CLAUDE_RELAY_TOKEN` secret, so the token never reaches the browser.
The site is public, so the proxy only answers a request carrying the key of
an existing sync space: AI works on devices with sync on. Set the secret with
`npx wrangler secret put CLAUDE_RELAY_TOKEN` (or in the dashboard under the
Worker's Settings → Variables and Secrets, type **Secret**, not Text). Deploys
never remove secrets; `keep_vars` in `wrangler.jsonc` also keeps plain
variables added in the dashboard. Without it the proxy answers 503 with a
message saying so.

The first action is **Suggest title**, in the row's ≡ menu and the `/` menu
(both hidden while sync is off). It sends the node's note and the items under
it, puts the answer in the row, and offers Undo; if the row was edited while
waiting, it offers the title instead of overwriting. New actions: write the
prompt next to `src/ai/suggest-title.ts`, add a method to `src/ai/service.ts`,
and register it in `src/ai/slash-commands.ts` and `NodeMenu.tsx`.

## Related panel

For the row you're on (the one you last clicked into or selected, or picked
via ≡ → Show related; else the zoomed item),
`src/related/` lists what else in the outline is about it, with no tags or
links. `find.ts` runs an OR search of the item's title words (weighed more),
note and children over the MiniSearch index, leaving out the item, its rows
and its parents; that list shows at once and gives the top button its count.
With sync on, `prompts.ts` then sends AI the item plus the rest of the
outline as numbered, indented rows (text matches and their parents first,
then level by level up to about 40k characters) and reads back up to 10
picks with a reason. AI asks only once you have stayed on a row for a moment,
and its picks are kept in localStorage per row with a fingerprint of the
row's own text (title, note, rows under it): coming back is instant, an edit
to the row makes AI look again, and Look again covers changes elsewhere.
While AI looks the panel shows grey placeholder rows, not the word matches,
which would otherwise show and then move. Once AI has looked, rows it did not
pick sit under "N more rows share words with it"; without sync the word
matches are the list.

The chat at the bottom sends the item as `[0]` and the listed rows as `[1]`,
`[2]`…, plus the last few turns; answers cite rows as `[n]`, which the panel
turns into jumps. The quick buttons (Next steps, What do I know?,
Duplicates?) are canned questions. Add to outline puts an answer's bullets
(or paragraphs) under the item as one undo step; Move here moves a related
row under the item. Both have Undo in the panel. The panel docks on the
right on wide screens (it and Settings close each other), is a drawer below
1024px, and a sheet from the bottom on phones.

## Installable app (PWA)

`public/manifest.webmanifest` and `public/icons/` let phones and desktop
Chrome install the app. `pwa/sw.js` is the service worker; on `pnpm build`,
`pwa/vite-plugin.ts` fills in the built files and a version and writes
`dist/sw.js` (dev mode registers no service worker).

- Page loads try the network first, so a new deploy shows up on the next
  open; the cached app is used only offline.
- Built files are precached, so the app opens offline after one online visit.
- `/api/*` (sync and AI) is never intercepted.

The manifest also makes the installed app an Android share target (`/share`)
and adds an Add to Inbox shortcut (`/capture`).

## Scripts

```
pnpm dev        start the app
pnpm preview    serve the production build
pnpm test       run unit tests (Vitest; test:watch to keep running)
pnpm test:e2e   run browser tests (Playwright; starts the dev server itself)
pnpm typecheck  tsc
pnpm knip       unused files, exports and dependencies
pnpm check      typecheck + unit tests + knip (run before pushing)
pnpm build      production build
```

## Deploy (Cloudflare)

The app is a static single-page app with its data in the browser
(IndexedDB). The only server code is in `worker/`: the opt-in sync API and
the AI proxy, which run for `/api/*` only; everything else is served as static assets, which
don't count toward Worker request limits. Its D1 database (`aletheia-sync`)
has no `database_id` in `wrangler.jsonc`, so `wrangler deploy` creates it on
the first deploy.

- **Workers (static assets)**: `pnpm build && npx wrangler deploy` using the
  included `wrangler.jsonc`, or connect the repository in the Cloudflare
  dashboard (Workers & Pages → Create → connect Git) with build command
  `pnpm build` and deploy command `npx wrangler deploy`.
- **Pages**: build command `pnpm build`, output directory `dist`.

Both serve `index.html` for unknown paths, so `/n/:id` links work on reload:
Workers via `not_found_handling: "single-page-application"`, Pages by default
since the build has no `404.html`. Don't add a `_redirects` catch-all
(`/* /index.html 200`); Workers rejects it as an infinite redirect loop.

The browser tests drive the app through `window.__aletheia` (engine, UI
store, editor session, search index, settings, sync, AI, related), which dev
builds expose. Set
`CHROMIUM_PATH` to use a preinstalled Chromium instead of the one Playwright
downloads.
