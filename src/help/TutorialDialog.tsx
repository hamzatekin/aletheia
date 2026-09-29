import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore, type UiStore } from '@/store/ui-store';

interface Props {
  ui: UiStore;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

/** A key combo like "Mod+Shift+Enter", drawn as keycaps. */
function Keys({ k }: { k: string }) {
  const parts = k.split('+').map((p) => (p === 'Mod' ? MOD : p === 'Alt' ? ALT : p));
  return (
    <span className="inline-flex flex-wrap items-center gap-1 whitespace-nowrap">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className="min-w-6 rounded border border-b-2 border-line bg-hover px-1.5 py-0.5 text-center font-mono text-xs text-ink"
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}

function Table({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="mb-5 w-full text-sm">
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i} className="border-b border-line last:border-0">
            <td className="w-[45%] py-2 pr-3 align-top">{a}</td>
            <td className="py-2 align-top text-muted">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-1 mb-2 text-sm font-semibold">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-muted">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-active px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

interface Tab {
  id: string;
  title: string;
  body: ReactNode;
}

const TABS: Tab[] = [
  {
    id: 'basics',
    title: 'Basics',
    body: (
      <>
        <P>
          Everything is an outline. Every line is a <b>node</b>, and any node can hold child nodes under it. There is no save button: every
          keystroke is saved in this browser right away.
        </P>
        <H>Writing</H>
        <Table
          rows={[
            [<Keys k="Enter" />, 'New node below. In the middle of a line, splits it in two.'],
            [<Keys k="Tab" />, 'Indent: make the node a child of the one above.'],
            [<Keys k="Shift+Tab" />, 'Outdent: move the node one level up.'],
            [<Keys k="Backspace" />, 'On an empty node, deletes it. At the start of a line, joins it with the line above.'],
            [<Keys k="Mod+Z" />, 'Undo. Redo is ' + MOD + '+Shift+Z or ' + MOD + '+Y.'],
          ]}
        />
        <H>Moving around</H>
        <Table
          rows={[
            [<Keys k="↑" />, 'Previous node (keeps the caret column).'],
            [<Keys k="↓" />, 'Next node.'],
            [<Keys k="←" />, 'At the start of a line, jumps to the end of the node above.'],
            [<Keys k="→" />, 'At the end of a line, jumps to the start of the node below.'],
            ['Click empty space', 'Stops editing.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'phone',
    title: 'On a phone',
    body: (
      <>
        <P>Everything works by touch too, the way WorkFlowy and Dynalist do it on a phone.</P>
        <Table
          rows={[
            ['Tap a line', 'Start editing it. A toolbar appears above the keyboard.'],
            ['Tap the arrow on the right', 'Every line with children has one. ▸ expands a collapsed node, ▾ collapses an open one. Collapsed nodes also have a halo around the bullet.'],
            ['Tap a bullet', 'Open the menu for that node: zoom in, note, star, move, duplicate, copy link, delete. Tap Home or a crumb at the top to go back.'],
            ['Tap ☆ by the title', 'Star the page: it shows under Starred at the top of the sidebar.'],
            ['Share → Aletheia', 'Once the app is installed, share a page or some text from any app: it lands at the top of your Inbox (a top-level line called Inbox, made for you the first time). Long-press the app icon for Add to Inbox, which opens a new line there to type into.'],
            ['Tap the magnifier', 'Search this page, top right. Only matching lines and the lines above them stay on screen.'],
            ['Long-press a line', 'Select it. Tap more lines to add or remove them, then use the bar at the bottom to indent, move, copy, cut, paste below or delete them all at once.'],
            ['Tap the ⇕ button', 'Next to the magnifier: collapse everything on the page, or expand it all.'],
          ]}
        />
        <H>The toolbar above the keyboard</H>
        <Table
          rows={[
            ['⇤  ⇥', 'Outdent and indent, in place of Shift+Tab and Tab.'],
            ['↑  ↓', 'Move the node up or down among its siblings.'],
            ['Note', "Write in the node's note; tap again to go back to the node."],
            ['Undo  Redo', 'Take back the last change, or bring it back.'],
            ['⋯', 'The same node menu as tapping the bullet.'],
            ['⌄', 'Stop editing and hide the keyboard.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'organize',
    title: 'Organize',
    body: (
      <>
        <H>Collapse and expand</H>
        <Table
          rows={[
            [<Keys k="Mod+↑" />, 'Collapse the node (hide its children).'],
            [<Keys k="Mod+↓" />, 'Expand it again.'],
            [<Keys k="Mod+Shift+." />, 'Collapse everything on the page, or expand it all when nothing is open. The button left of the magnifier at the top does the same, and the ≡ menu has Collapse all inside and Expand all inside for one node.'],
            ['The ▸ arrow', 'Left of a bullet, shown on hover: click it to collapse or expand. On a phone it sits at the right end of the line. A bullet with a grey halo has hidden children.'],
          ]}
        />
        <H>Zoom</H>
        <P>Zooming shows one node as the page title, with only its children below. Breadcrumbs at the top take you back.</P>
        <Table
          rows={[
            ['Click a bullet', 'Zoom into that node.'],
            [<Keys k="Mod+." />, 'Zoom into the node you are editing.'],
            [<Keys k="Mod+," />, 'Zoom out one level.'],
            ['Outline sidebar', 'Click any item to zoom straight to it.'],
            ['☆ left of the page title', 'Star the page you are on, like WorkFlowy: it is listed under Starred at the top of the sidebar, on every synced device. The ≡ menu does the same for any node (on a phone, tap its bullet); click the gold star in the sidebar to unstar.'],
          ]}
        />
        <H>Move nodes</H>
        <Table
          rows={[
            [<Keys k="Alt+Shift+↑" />, 'Move the node (with its children) up among its siblings.'],
            [<Keys k="Alt+Shift+↓" />, 'Move it down.'],
            ['Drag a bullet', 'Or the ≡ grip left of it. The blue line shows where it lands; move left or right to change its level. Click the grip for a menu of actions on that node.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'select',
    title: 'Select',
    body: (
      <>
        <P>Select whole nodes instead of their text, then act on all of them at once. Copying keeps their children and notes: paste them back here to get the same nodes, or anywhere else to get indented bullets.</P>
        <Table
          rows={[
            [<Keys k="Esc" />, 'Select the current node. Press again to clear the selection.'],
            ['Shift+click', 'Select every row from the node you are in to the one you click.'],
            [MOD + '+click', 'Add a node to the selection, or take it out.'],
            ['Drag across rows', 'Press in one row and drag into others to select them.'],
            [<Keys k="Shift+↑" />, 'Extend the selection up. Shift+↓ extends it down. While editing, it first selects the text, then nodes.'],
            [<Keys k="Mod+A" />, 'Twice while editing, or once in a selection: select every node on the page.'],
            [<Keys k="Mod+C" />, 'Copy the selected nodes. ' + MOD + '+X cuts them.'],
            [<Keys k="Mod+V" />, 'Paste below the selection, or into the node you are editing.'],
            [<Keys k="Tab" />, 'Indent every selected node. Shift+Tab outdents.'],
            [<Keys k="Backspace" />, 'Delete the selected nodes and everything under them. Undo brings them back.'],
            [<Keys k="Alt+Shift+↑" />, 'Move the selected nodes up or down.'],
            [<Keys k="Mod+↑" />, 'Collapse the selected nodes. ' + MOD + '+↓ expands them.'],
            [<Keys k="Mod+." />, 'Zoom into the selected node.'],
            [<Keys k="Enter" />, 'Go back to editing the node.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'markdown',
    title: 'Markdown',
    body: (
      <>
        <P>Type Markdown and it turns into formatting as soon as you close it. What is stored is plain Markdown, so exports stay clean.</P>
        <Table
          rows={[
            [<Code>**bold**</Code>, <b>bold</b>],
            [<Code>*italic*</Code>, <i>italic</i>],
            [<Code>`code`</Code>, <Code>code</Code>],
            [<Code>~~strike~~</Code>, <s>strike</s>],
            [<Code>[text](https://…)</Code>, 'A link. Pasting a URL onto selected text also makes a link.'],
            [<Keys k="Mod+B" />, 'Bold. ' + MOD + '+I is italic, ' + MOD + '+E is code.'],
          ]}
        />
        <P>
          A node holds one line of inline Markdown. For lists, quotes, code blocks or headings, use a <b>note</b> (see the Notes tab).
        </P>
      </>
    ),
  },
  {
    id: 'notes',
    title: 'Notes',
    body: (
      <>
        <P>Every node can carry a note: longer text shown in smaller type under it. Notes take full Markdown.</P>
        <Table
          rows={[
            [<Keys k="Shift+Enter" />, 'Open or edit the note of the current node.'],
            [<Keys k="Esc" />, 'Leave the note and go back to the node.'],
            ['Click a note', 'Edit it. Markdown renders as you type: "## " makes a heading, "- " a list, ``` a code block.'],
            ['Rendered / Markdown', 'Click the small icon at the upper right of a note to switch between rendered and raw Markdown editing.'],
            ['▾ left of a note', 'Notes start collapsed to their first line: expand or collapse one here or in the ≡ menu. A note you open stays open. Settings can start them expanded.'],
          ]}
        />
        <H>What works in notes</H>
        <Table
          rows={[
            [<Code>- item</Code>, 'Bulleted list (1. for numbered)'],
            [<Code>&gt; quote</Code>, 'Quote'],
            [<Code>```</Code>, 'Code block'],
            [<Code># Heading</Code>, 'Heading'],
            [<Code>| a | b |</Code>, 'Table (a header row, then |---|---|)'],
            ['Terminal output', 'Paste an answer copied from Claude Code and its box tables become real tables. For notes imported earlier, use ≡ → Format terminal output.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'commands',
    title: 'Search & commands',
    body: (
      <>
        <H>Search</H>
        <Table
          rows={[
            [<Keys k="Mod+F" />, 'Search this page in place, like WorkFlowy and Dynalist: only matching lines stay, with the lines above them, and the words are highlighted. A match hides its own children until you open it. Enter jumps into the first match; Esc (or the magnifier) shows everything again.'],
            [<Keys k="Mod+K" />, 'Jump anywhere: search every node, ↑ ↓ to pick, Enter to go there, Esc to close.'],
          ]}
        />
        <H>Related</H>
        <P>
          The linked-dots button at the top (or Show related in an item's ≡ menu) lists what else in your notes is about the item you're on, with no tags or links needed. Rows sharing its words show at once; with sync on, AI adds rows related by meaning and says why. Tap a row to peek at it, Go there to zoom in, or Move here to put it under this item. Ask AI about the item and those rows at the bottom, or tap Next steps; Add to outline puts an answer's bullets under the item (Undo takes them back).
        </P>
        <H>Slash commands</H>
        <P>
          Type <Code>/</Code> while editing a line or a rendered note to insert formatting or run AI on it. Actions on the node itself are in its ≡ menu; import and export are in Settings. Keep typing to filter, ↑ ↓ to pick, Enter to run, Esc to close.
        </P>
        <Table
          rows={[
            [<Code>/bold</Code>, 'Bold, Italic, Strikethrough, Inline code, Link. In a line or a note.'],
            [<Code>/heading</Code>, 'In a note: Heading 1 to 3, Text, Bulleted list, Numbered list, Quote, Code block, Table, Divider.'],
            [<Code>/suggest</Code>, 'Suggest title: AI names the row from its note and the items under it (Undo to put it back). Needs sync on.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'data',
    title: 'Import & backup',
    body: (
      <>
        <P>Your notes live only in this browser (no account, no server). Export a backup now and then so you never lose them.</P>
        <Table
          rows={[
            ['Settings → Import', 'Markdown or OPML. The file comes in as one new item at the top of Home, named after the file and the date, with its contents inside. For WorkFlowy, export as OPML: formatting and notes carry over, completed items come in struck through, and terminal output kept in code blocks comes in as readable Markdown.'],
            ['Settings → Download', 'Everything as an indented Markdown list, as OPML (for Dynalist or WorkFlowy), or as a JSON backup exactly as stored.'],
            ['Settings → Restore backup', 'Replaces everything with a JSON backup.'],
            ['Paste several lines', 'Each line becomes a node, nested by its indentation, as one undo step.'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'look',
    title: 'Look & feel',
    body: (
      <>
        <Table
          rows={[
            ['Gear button (top right)', 'Theme, colors, font, font size, line spacing, page shape (portrait or landscape), page width, book page.'],
            ['Drag the edge of the page', 'Make the page wider or narrower. Double-click the edge to reset.'],
            [<Keys k="Mod+\" />, 'Show or hide the outline sidebar.'],
            ['Outline levels shown', 'In settings: how deep the sidebar opens by default.'],
            [<Keys k="Mod+/" />, 'Open this tutorial.'],
          ]}
        />
        <P>Appearance settings are saved in this browser, like your notes.</P>
      </>
    ),
  },
];

/** A tabbed guide to every shortcut and hidden feature. */
export function TutorialDialog({ ui }: Props) {
  const open = useUiStore(ui, (s) => s.helpOpen);
  const [tab, setTab] = useState(TABS[0]!.id);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        ui.setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, ui]);

  if (!open) return null;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) ui.setHelpOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial"
        data-testid="tutorial"
        className="flex h-[min(38rem,calc(100vh-1.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface text-ink shadow-2xl sm:flex-row"
      >
        <nav
          className="tabs-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-48 sm:flex-col sm:border-r sm:border-b-0 sm:p-3"
          role="tablist"
          aria-label="Tutorial topics"
        >
          <div className="hidden px-2 pb-2 text-xs font-semibold tracking-wider text-muted uppercase sm:block">Tutorial</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === current.id}
              onClick={(e) => {
                setTab(t.id);
                e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }}
              className={
                'shrink-0 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap ' +
                (t.id === current.id ? 'bg-active font-medium' : 'text-muted hover:bg-hover')
              }
            >
              {t.title}
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-lg font-semibold">{current.title}</h2>
            <button
              ref={closeRef}
              type="button"
              onClick={() => ui.setHelpOpen(false)}
              className="rounded p-1 text-muted hover:bg-hover hover:text-ink"
              aria-label="Close tutorial"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" role="tabpanel">
            {current.body}
          </div>
        </div>
      </div>
    </div>
  );
}
