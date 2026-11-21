import { isMac } from '@/ui/media';

const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

/** "Mod+Shift+Enter" as this device's keys. */
export const keyParts = (k: string) => k.split('+').map((p) => (p === 'Mod' ? MOD : p === 'Alt' ? ALT : p));

/*
 * The tutorial is data, not elements: the dialog draws it, and Ask AI reads
 * the same data as plain text (`tutorialText`). Solid has no element tree to
 * walk, so a page of JSX could not be turned back into text.
 */

/** A styled bit inside a line: a key combo as keycaps, inline code, bold, italic or struck through. */
export type Mark = { keys: string } | { code: string } | { bold: string } | { italic: string } | { strike: string };
/** One cell or paragraph: text, one mark, or a mix. */
export type Inline = string | Mark | readonly (string | Mark)[];
export type Block = { p: Inline } | { h: string } | { table: readonly (readonly [Inline, Inline])[] };
export interface Tab {
  id: string;
  title: string;
  body: readonly Block[];
}

const keys = (k: string): Mark => ({ keys: k });
const code = (c: string): Mark => ({ code: c });
const bold = (t: string): Mark => ({ bold: t });
const italic = (t: string): Mark => ({ italic: t });
const strike = (t: string): Mark => ({ strike: t });
const p = (...parts: (string | Mark)[]): Block => ({ p: parts });
const h = (t: string): Block => ({ h: t });
const table = (...rows: [Inline, Inline][]): Block => ({ table: rows });

export const TABS: readonly Tab[] = [
  {
    id: 'basics',
    title: 'Basics',
    body: [
      p(
        'Everything is an outline. Every line is a ',
        bold('node'),
        ', and any node can hold child nodes under it. There is no save button: every keystroke is saved in this browser right away.',
      ),
      h('Writing'),
      table(
        [keys('Enter'), 'New node below. In the middle of a line, splits it in two.'],
        [keys('Tab'), 'Indent: make the node a child of the one above.'],
        [keys('Shift+Tab'), 'Outdent: move the node one level up.'],
        [keys('Backspace'), 'On an empty node, deletes it. At the start of a line, joins it with the line above.'],
        [keys('Mod+Z'), 'Undo. Redo is ' + MOD + '+Shift+Z or ' + MOD + '+Y.'],
      ),
      h('Moving around'),
      table(
        [keys('↑'), 'Previous node (keeps the caret column).'],
        [keys('↓'), 'Next node.'],
        [keys('←'), 'At the start of a line, jumps to the end of the node above.'],
        [keys('→'), 'At the end of a line, jumps to the start of the node below.'],
        ['Click empty space', 'Stops editing.'],
      ),
    ],
  },
  {
    id: 'phone',
    title: 'On a phone',
    body: [
      p('Everything works by touch too, the way WorkFlowy and Dynalist do it on a phone.'),
      table(
        ['Tap a line', 'Start editing it. A toolbar appears above the keyboard.'],
        ['Tap the arrow on the right', 'Every line with children has one. ▸ expands a collapsed node, ▾ collapses an open one. Collapsed nodes also have a halo around the bullet.'],
        ['Tap a bullet', 'Zoom into that node. Tap Home or a crumb at the top to go back.'],
        ['Long-press a bullet', 'Open the menu for that node: complete, note, star, move, duplicate, copy link, heading, color, delete. Tap outside it to close it.'],
        ['Tap ☆ by the title', 'Star the page: it shows under Starred at the top of the sidebar.'],
        ['Share → Aletheia', 'Once the app is installed, share a page or some text from any app: it lands at the top of your Inbox (a top-level line called Inbox, made for you the first time).'],
        ['+ at the bottom right', 'Add a new item to your Inbox and type it; the note button in the bar takes you into its note. The Inbox shows when each item was added. Long-press the app icon and pick Add to Inbox for the same thing from your home screen.'],
        ['Mic above the +', 'Say a voice memo (sync must be on). Tap Done and it lands at the top of your Inbox, titled and tidied by AI in your own words, and opens. Up to 5 minutes; Cancel throws it away.'],
        ['Tap the magnifier', 'Search this page, top right. Only matching lines and the lines above them stay on screen.'],
        ['Long-press a line', 'Select it. Tap more lines to add or remove them, then use the bar at the bottom to indent, move, copy, cut, paste below or delete them all at once.'],
        ['Tap the ⇕ button', 'Next to the magnifier: collapse everything on the page, or expand it all.'],
      ),
      h('The toolbar above the keyboard'),
      table(
        ['⇤  ⇥', 'Outdent and indent, in place of Shift+Tab and Tab.'],
        ['↑  ↓', 'Move the node up or down among its siblings.'],
        ['Note', "Write in the node's note; tap again to go back to the node."],
        ['Undo  Redo', 'Take back the last change, or bring it back.'],
        ['⋯', 'The same node menu as a long press on the bullet.'],
        ['⌄', 'Stop editing and hide the keyboard.'],
      ),
    ],
  },
  {
    id: 'organize',
    title: 'Organize',
    body: [
      h('Collapse and expand'),
      table(
        [keys('Mod+↑'), 'Collapse the node (hide its children).'],
        [keys('Mod+↓'), 'Expand it again.'],
        [keys('Mod+Shift+.'), 'Collapse everything on the page, or expand it all when nothing is open. The button left of the magnifier at the top does the same, and the ≡ menu has Collapse all inside and Expand all inside for one node.'],
        ['The ▸ arrow', 'Left of a bullet, shown on hover: click it to collapse or expand. On a phone it sits at the right end of the line. A bullet with a grey halo has hidden children.'],
      ),
      h('Zoom'),
      p('Zooming shows one node as the page title, with only its children below. Breadcrumbs at the top take you back.'),
      table(
        ['Click a bullet', 'Zoom into that node.'],
        [keys('Mod+.'), 'Zoom into the node you are editing.'],
        [keys('Mod+,'), 'Zoom out one level.'],
        [keys('Mod+Alt+N'), 'Add to Inbox: a new item at the top of your Inbox, zoomed into, to type it. Shift+Enter goes on into its note. The + at the top right does the same.'],
        ['Outline sidebar', 'Click any item to zoom straight to it.'],
        ['☆ left of the page title', 'Star the page you are on, like WorkFlowy: it is listed under Starred at the top of the sidebar, on every synced device. The ≡ menu does the same for any node (on a phone, long-press its bullet); click the gold star in the sidebar to unstar.'],
      ),
      h('Done items, headings and colors'),
      table(
        [keys('Mod+Enter'), 'Complete the node: it stays, struck through, until you hide done items. Again marks it not done. With nodes selected, it completes them all. The ≡ menu has Complete too.'],
        [keys('Mod+O'), 'Show or hide done items, on every page. Settings → Show completed does the same.'],
        ['H1 H2 H3 in the ≡ menu', 'Make the node a heading, larger and bold, like Dynalist. Pick it again for a normal line.'],
        ['Colors in the ≡ menu', 'Give the node a color label: a soft band of color behind its text. Pick it again to remove it.'],
        ['Settings → Recently deleted', 'Everything you deleted, newest first. Restore puts an item back where it was, with what was deleted along with it.'],
      ),
      h('Move nodes'),
      table(
        [keys('Alt+Shift+↑'), 'Move the node (with its children) up among its siblings.'],
        [keys('Alt+Shift+↓'), 'Move it down.'],
        ['Drag a bullet', 'Or the ≡ grip left of it. The blue line shows where it lands; move left or right to change its level. Click the grip for a menu of actions on that node.'],
      ),
    ],
  },
  {
    id: 'select',
    title: 'Select',
    body: [
      p('Select whole nodes instead of their text, then act on all of them at once. Copying keeps their children and notes: paste them back here to get the same nodes, or anywhere else to get indented bullets.'),
      table(
        [keys('Esc'), 'Select the current node. Press again to clear the selection.'],
        ['Shift+click', 'Select every row from the node you are in to the one you click.'],
        [MOD + '+click', 'Add a node to the selection, or take it out.'],
        ['Drag across rows', 'Press in one row and drag into others to select them.'],
        [keys('Shift+↑'), 'Extend the selection up. Shift+↓ extends it down. While editing, it first selects the text, then nodes.'],
        [keys('Mod+A'), 'Twice while editing, or once in a selection: select every node on the page.'],
        [keys('Mod+C'), 'Copy the selected nodes. ' + MOD + '+X cuts them.'],
        [keys('Mod+V'), 'Paste below the selection, or into the node you are editing.'],
        [keys('Tab'), 'Indent every selected node. Shift+Tab outdents.'],
        [keys('Backspace'), 'Delete the selected nodes and everything under them. Undo brings them back.'],
        [keys('Alt+Shift+↑'), 'Move the selected nodes up or down.'],
        [keys('Mod+↑'), 'Collapse the selected nodes. ' + MOD + '+↓ expands them.'],
        [keys('Mod+.'), 'Zoom into the selected node.'],
        [keys('Enter'), 'Go back to editing the node.'],
      ),
    ],
  },
  {
    id: 'markdown',
    title: 'Markdown',
    body: [
      p('Type Markdown and it turns into formatting as soon as you close it. What is stored is plain Markdown, so exports stay clean.'),
      table(
        [code('**bold**'), bold('bold')],
        [code('*italic*'), italic('italic')],
        [code('`code`'), code('code')],
        [code('~~strike~~'), strike('strike')],
        [code('[text](https://…)'), 'A link. Pasting a URL onto selected text also makes a link.'],
        [keys('Mod+B'), 'Bold. ' + MOD + '+I is italic, ' + MOD + '+E is code, ' + MOD + '+Shift+S strikes through.'],
      ),
      p('A node holds one line of inline Markdown. For lists, quotes, code blocks or headings, use a ', bold('note'), ' (see the Notes tab).'),
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    body: [
      p("Every node can carry a note: the rest of its block, shown right under it in slightly smaller type. Notes take full Markdown. An item with no name takes its note's first line as its name when you leave it."),
      table(
        [keys('Shift+Enter'), 'Go on writing in the note of the current node. ↓ on its last line does the same.'],
        [keys('Esc'), 'Leave the note and go back to the node.'],
        ['Click a note', 'Edit it. Markdown renders as you type: "## " makes a heading, "- " a list, "[] " a checklist, ``` a code block.'],
        ['Rendered / Markdown', 'Click the small icon at the upper right of a note to switch between rendered and raw Markdown editing.'],
        ['Hidden notes', 'Notes are hidden in the list (a small ≡ at the right marks an item with one) and show while you are on their item or zoomed into it. Keep one open here or in the ≡ menu; Settings can show them all.'],
      ),
      h('What works in notes'),
      table(
        [code('- item'), 'Bulleted list (1. for numbered). Tab nests an item, Shift+Tab takes it back out.'],
        [code('[] item'), 'Checklist, also "- [ ] " ("[x] " starts it ticked). Click a box to tick it, even without opening the note; Enter adds the next item.'],
        [code('> quote'), 'Quote'],
        [code('```'), 'Code block'],
        [code('# Heading'), 'Heading (## to ###### for smaller ones)'],
        [code('| a | b |'), 'Table (a header row, then |---|---|; :---: centers a column, ---: aligns it right)'],
        [code('![alt](url)'), 'Image. Links starting with https:// work without brackets too.'],
        ['Terminal output', 'Paste an answer copied from Claude Code and its box tables become real tables. For notes imported earlier, use ≡ → Format terminal output.'],
        ['Editing', 'Editing a note rewrites only the parts you changed, so everything else stays exactly as it was written.'],
      ),
    ],
  },
  {
    id: 'commands',
    title: 'Search & commands',
    body: [
      h('Search'),
      table(
        [keys('Mod+F'), 'Search this page in place, like WorkFlowy and Dynalist: only matching lines stay, with the lines above them, and the words are highlighted. A match hides its own children until you open it. Enter jumps into the first match; Esc (or the magnifier) shows everything again.'],
        [keys('Mod+K'), 'Jump anywhere: search every node, ↑ ↓ to pick, Enter to go there, Esc to close.'],
      ),
      h('Ask AI'),
      p(
        "The sparkle button at the top opens one chat about your notes (sync must be on). Ask anything: AI searches and opens your rows by itself, starting from the row you're on, and adds, moves, edits or stars rows when you ask. It never deletes. What it changed is listed under the answer, and Undo takes it all back. The chat stays while you move around; New chat starts over. In a new chat, My week looks back on your last 7 days: what you added, what you finished and what still waits in your Inbox. AI keeps what it learns about you in a row called “AI memory” at the bottom of Home, which you can read and edit.",
      ),
      h('Slash commands'),
      p(
        'Type ',
        code('/'),
        ' while editing a line or a rendered note to insert formatting or run AI on it. Actions on the node itself are in its ≡ menu; import and export are in Settings. Keep typing to filter, ↑ ↓ to pick, Enter to run, Esc to close.',
      ),
      table(
        [code('/bold'), 'Bold, Italic, Strikethrough, Inline code, Link. In a line or a note.'],
        [code('/heading'), 'In a note: Heading 1 to 3, Text, Bulleted list, Checklist, Numbered list, Quote, Code block, Table, Divider.'],
        [code('/suggest'), 'Suggest title: AI names the row from its note and the items under it (Undo to put it back). Needs sync on.'],
      ),
    ],
  },
  {
    id: 'data',
    title: 'Import & backup',
    body: [
      p('Your notes live only in this browser (no account, no server). Export a backup now and then so you never lose them.'),
      table(
        ['Settings → Import', 'Markdown or OPML. The file comes in as one new item at the top of Home, named after the file and the date, with its contents inside. For WorkFlowy, export as OPML: formatting and notes carry over, completed items come in struck through, and terminal output kept in code blocks comes in as readable Markdown.'],
        ['Settings → Download', 'Everything as an indented Markdown list, as OPML (for Dynalist or WorkFlowy), or as a JSON backup exactly as stored.'],
        ['Settings → Restore backup', 'Replaces everything with a JSON backup.'],
        ['Paste several lines', 'Each line becomes a node, nested by its indentation, as one undo step.'],
      ),
    ],
  },
  {
    id: 'look',
    title: 'Look & feel',
    body: [
      table(
        ['Gear button (top right)', 'Theme, colors, font, font size, line spacing, page shape (portrait or landscape), page width, book page.'],
        ['Drag the edge of the page', 'Make the page wider or narrower. Double-click the edge to reset.'],
        [keys('Mod+\\'), 'Show or hide the outline sidebar.'],
        ['Outline levels shown', 'In settings: how deep the sidebar opens by default.'],
        [keys('Mod+/'), 'Open this tutorial.'],
      ),
      p('Appearance settings are saved in this browser, like your notes.'),
    ],
  },
];

/** The pieces of a cell or paragraph, in order. */
export const asParts = (n: Inline): readonly (string | Mark)[] => (Array.isArray(n) ? (n as readonly (string | Mark)[]) : [n as string | Mark]);

/** Plain text of one piece: a key combo as "⌘+Shift+Enter", code in backticks, anything else as it reads. */
function plainPart(m: string | Mark): string {
  if (typeof m === 'string') return m;
  if ('keys' in m) return keyParts(m.keys).join('+');
  if ('code' in m) return `\`${m.code}\``;
  if ('bold' in m) return m.bold;
  if ('italic' in m) return m.italic;
  return m.strike;
}

const plainInline = (n: Inline): string => asParts(n).map(plainPart).join('');

/** Plain text of one block: headings, paragraphs and "- key: what it does" lines. */
function plainBlock(b: Block): string {
  if ('h' in b) return `\n## ${b.h}\n`;
  if ('p' in b) return `${plainInline(b.p).trim()}\n`;
  return b.table.map(([a, c]) => `- ${plainInline(a)}: ${plainInline(c)}\n`).join('');
}

/** The whole tutorial as plain text, so Ask AI can answer questions about the app from it. */
export function tutorialText(): string {
  return TABS.map((t) => `# ${t.title}\n${t.body.map(plainBlock).join('').trim()}`).join('\n\n');
}
