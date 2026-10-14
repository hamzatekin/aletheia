import type { MarkdownIt, RendererRule, StateCore, Token } from 'markdown-it';

/** "[ ]" or "[x]" opening a list item's text, as in GitHub; an empty item ("- [ ]") counts too. */
const MARKER = /^\[([ xX])\](?:[ \t]+|$)/;

const installed = new WeakSet<MarkdownIt>();

/** A bulleted item's line up to its checkbox, inside any quotes: "- ", "  * ", "> - ". */
const ITEM_PREFIX = /^((?:[ \t]*>)*[ \t]*[-*+][ \t]+)\[([ xX])\]/;

/**
 * GitHub task lists ("- [ ] todo", "- [x] done"), rendered with the same
 * markup as Tiptap's task list (ul[data-type=taskList] > li[data-type=taskItem]
 * > label + div), so a rendered note and its editor lay out alike and the
 * editor can load the rendered HTML. Each checkbox carries the source line of
 * its item (`data-line`) so a click can tick it without opening the editor.
 * As in the editor, a checklist is a bulleted list whose items are all tasks;
 * a list that mixes tasks and plain items shows its "[ ]" as text.
 */
export function taskLists(md: MarkdownIt): void {
  // tiptap-markdown sets its parser up again for every note it loads.
  if (installed.has(md)) return;
  installed.add(md);
  md.core.ruler.after('block', 'task_lists', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type !== 'bullet_list_open') continue;
      const items = listItems(tokens, i);
      const marks = items.map((at) => (tokens[at + 1]?.type === 'paragraph_open' && tokens[at + 2]?.type === 'inline' ? MARKER.exec(tokens[at + 2]!.content) : null));
      if (marks.some((m) => m === null)) continue;
      const list = tokens[i]!;
      list.attrSet('data-type', 'taskList');
      // The editor keeps an item's text in a paragraph even in a tight list; so does
      // this, and says the list is tight so the editor saves it without blank lines.
      if (tokens[items[0]! + 1]!.hidden) list.attrSet('data-tight', 'true');
      items.forEach((at, k) => {
        const item = tokens[at]!;
        const [open, inline, close] = [tokens[at + 1]!, tokens[at + 2]!, tokens[at + 3]];
        const checked = marks[k]![1] !== ' ';
        inline.content = inline.content.slice(marks[k]![0].length);
        open.hidden = false;
        if (close?.type === 'paragraph_close') close.hidden = false;
        item.attrSet('data-type', 'taskItem');
        item.attrSet('data-checked', String(checked));
        item.meta = { task: { checked, line: item.map?.[0] ?? 0 } };
        const end = closingItem(tokens, at);
        if (end) end.meta = { task: true };
      });
    }
  });

  const render: RendererRule = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);
  const itemOpen = md.renderer.rules.list_item_open ?? render;
  const itemClose = md.renderer.rules.list_item_close ?? render;
  md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
    const task = (tokens[idx]!.meta as { task?: { checked: boolean; line: number } } | null)?.task;
    const html = itemOpen(tokens, idx, options, env, self);
    if (!task) return html;
    const checked = task.checked ? ' checked=""' : '';
    return `${html.replace(/\n$/, '')}<label><input type="checkbox"${checked} tabindex="-1" data-line="${task.line}"></label><div>`;
  };
  md.renderer.rules.list_item_close = (tokens, idx, options, env, self) =>
    (tokens[idx]!.meta as { task?: boolean } | null)?.task ? `</div>${itemClose(tokens, idx, options, env, self)}` : itemClose(tokens, idx, options, env, self);
}

/** Positions of the items directly in the list opening at `idx`. */
function listItems(tokens: Token[], idx: number): number[] {
  const level = tokens[idx]!.level;
  const items: number[] = [];
  for (let j = idx + 1; j < tokens.length && tokens[j]!.level > level; j++) if (tokens[j]!.level === level + 1 && tokens[j]!.type === 'list_item_open') items.push(j);
  return items;
}

/** The token that closes the list item opening at `idx`. */
function closingItem(tokens: Token[], idx: number): Token | undefined {
  const level = tokens[idx]!.level;
  for (let j = idx + 1; j < tokens.length; j++) if (tokens[j]!.level === level && tokens[j]!.type === 'list_item_close') return tokens[j];
  return undefined;
}

/** The note with the checkbox of the task item starting on `line` ticked or cleared; unchanged if that line holds none. */
export function toggleTask(note: string, line: number, checked: boolean): string {
  const lines = note.split('\n');
  const text = lines[line];
  if (text === undefined || !ITEM_PREFIX.test(text)) return note;
  lines[line] = text.replace(ITEM_PREFIX, (_all, prefix: string) => `${prefix}[${checked ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** The checkbox of a rendered note's task item under a press or click, if any. */
export function taskCheckboxAt(target: EventTarget): HTMLInputElement | null {
  const label = (target as Element).closest?.("li[data-type='taskItem'] > label");
  return label?.querySelector<HTMLInputElement>('input[data-line]') ?? null;
}

/** The note after clicking `box` in its rendered form: that item ticked or cleared. */
export function noteAfterTick(note: string, box: HTMLInputElement): string {
  return toggleTask(note, Number(box.dataset.line), !box.hasAttribute('checked'));
}
