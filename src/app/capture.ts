import type { Command, Engine } from '@/commands';
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
