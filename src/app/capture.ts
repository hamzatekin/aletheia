import type { Command, Engine } from '@/commands';
import { liftFirstLine } from '@/editor/first-line';
import { plainText } from '@/editor/markdown';
import { newId, type TreeReader } from '@/model';

/** What Android's share sheet hands the installed app (see share_target in the manifest). */
export interface Shared {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"]+/;

/**
 * Turn a share into a node: a link titled with the page title when a URL came
 * along, else the first line of the text, with anything left over as the note.
 */
export function sharedItem({ title, text, url }: Shared): { content: string; note: string } {
  const t = (title ?? '').trim();
  let body = (text ?? '').trim();
  let link = (url ?? '').trim();
  if (link === '') {
    const m = URL_RE.exec(body);
    if (m) link = m[0];
  }
  if (link !== '') body = body.replace(link, '').replace(/[ \t]{2,}/g, ' ').trim();

  if (link !== '') {
    // Chrome shares "title" plus text that often repeats it; keep the rest as the note.
    let label = t;
    if (label === '') {
      const [first = '', ...rest] = body.split('\n');
      label = first.trim();
      body = rest.join('\n').trim();
    } else if (body.startsWith(label)) {
      body = body.slice(label.length).trim();
    }
    label = label.replace(/[[\]]/g, '');
    return { content: label === '' ? link : `[${label}](${link})`, note: body };
  }

  const lines = body.split('\n');
  if (t !== '') return { content: t, note: body };
  return { content: (lines[0] ?? '').trim(), note: lines.slice(1).join('\n').trim() };
}

/**
 * The name quick adds used to get: when they were added, in the device's
 * language ("Oct 12, 2026, 1:54 PM"). Quick adds now start nameless and take
 * the first line typed (see nameFromNote); this finds the old ones.
 */
export function captureTitle(now: Date = new Date(), locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(now);
}

/**
 * When an Inbox item was added, shown at its right: day and month, with the
 * time unless `short` (phones), and the year only when it isn't this year.
 */
export function addedLabel(at: number, { now = new Date(), locale, short = false }: { now?: Date; locale?: string | undefined; short?: boolean } = {}): string {
  const date = new Date(at);
  const thisYear = date.getFullYear() === now.getFullYear();
  const options: Intl.DateTimeFormatOptions = thisYear
    ? { day: 'numeric', month: 'short', ...(short ? {} : { hour: 'numeric', minute: '2-digit' }) }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/**
 * Inbox items that an old quick add named with its date and time (still
 * exactly that name) take their note's first line as the name instead, as
 * new quick adds do, in one undo step. The date still shows at the right.
 * Returns how many were renamed.
 */
export function liftCaptureTitles(engine: Engine, locale?: string): number {
  const inbox = findInbox(engine.tree);
  if (inbox === null) return 0;
  const commands: Command[] = [];
  for (const id of engine.tree.children(inbox)) {
    const node = engine.tree.get(id);
    if (!node || node.content !== captureTitle(new Date(node.createdAt), locale)) continue;
    const lifted = liftFirstLine(node.note);
    if (!lifted) continue;
    commands.push({ type: 'updateContent', id, content: lifted.content }, { type: 'updateNote', id, note: lifted.note });
  }
  if (commands.length > 0) engine.batch(commands, 'liftCaptureTitles');
  return commands.length / 2;
}

/** The top-level node called "Inbox", if there is one. */
export function findInbox(tree: TreeReader): string | null {
  return tree.children(null).find((id) => plainText(tree.get(id)?.content ?? '').trim().toLowerCase() === 'inbox') ?? null;
}

/**
 * Add an item at the top of the Inbox (made at the top of Home if missing),
 * as one undo step. Returns the Inbox and the new node.
 */
export function addToInbox(engine: Engine, item: { content: string; note: string }): { inbox: string; id: string } {
  const commands: Command[] = [];
  let inbox = findInbox(engine.tree);
  if (inbox === null) {
    inbox = newId();
    commands.push({ type: 'createNode', id: inbox, parentId: null, at: 'first', content: 'Inbox' });
  } else if (engine.tree.get(inbox)?.collapsed) {
    commands.push({ type: 'toggleCollapse', id: inbox, collapsed: false });
  }
  const id = newId();
  commands.push({ type: 'createNode', id, parentId: inbox, at: 'first', content: item.content, note: item.note });
  engine.batch(commands, 'capture');
  return { inbox, id };
}
