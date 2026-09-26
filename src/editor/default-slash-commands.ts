import type { Command } from '@/commands';
import { ancestorIds, descendantIds } from '@/model';
import { downloadText, pickTextFile, safeFilename } from '@/io/browser';
import { exportJson, exportMarkdown, exportOpml, parseBackup } from '@/io/export';
import { importItems, parseMarkdownOutline, parseOpml } from '@/io/import';
import { plainText } from './markdown';
import { registerSlashCommand, type SlashCommand, type SlashContext } from './slash-registry';

function setCollapsedUnder(ctx: SlashContext, collapsed: boolean): void {
  const { tree } = ctx.engine;
  const ids = ctx.rootId === null ? [...tree.all()].filter((n) => n.deletedAt === null).map((n) => n.id) : descendantIds(tree, ctx.rootId);
  const commands: Command[] = ids
    .filter((id) => tree.children(id).length > 0)
    .map((id) => ({ type: 'toggleCollapse', id, collapsed }));
  ctx.engine.batch(commands, collapsed ? 'collapseAll' : 'expandAll');
  if (collapsed) {
    // The edited node is now hidden; keep the caret on its highest collapsed ancestor.
    const chain = ancestorIds(tree, ctx.nodeId);
    const top = chain.filter((a) => tree.get(a)?.parentId === ctx.rootId)[0];
    if (top) ctx.ui.focusNode(top, { kind: 'end' });
  }
}

function exportName(ctx: SlashContext, ext: string): string {
  const root = ctx.rootId === null ? null : ctx.engine.tree.get(ctx.rootId);
  return safeFilename(root ? plainText(root.content) : 'aletheia', ext);
}

async function importWith(ctx: SlashContext, accept: string, parse: (text: string) => ReturnType<typeof parseMarkdownOutline>): Promise<void> {
  const text = await pickTextFile(accept);
  if (text === null) return;
  const items = parse(text);
  if (items.length === 0) return;
  const outcome = importItems(ctx.engine, ctx.nodeId, items);
  if (outcome.ok) ctx.engine.execute({ type: 'toggleCollapse', id: ctx.nodeId, collapsed: false });
}

export const defaultSlashCommands: SlashCommand[] = [
  { id: 'bold', title: 'Bold', keywords: 'strong', group: 'Format', run: (c) => c.session.editor.chain().focus().toggleBold().run() },
  { id: 'italic', title: 'Italic', keywords: 'emphasis', group: 'Format', run: (c) => c.session.editor.chain().focus().toggleItalic().run() },
  { id: 'code', title: 'Code', keywords: 'monospace', group: 'Format', run: (c) => c.session.editor.chain().focus().toggleCode().run() },
  {
    id: 'link',
    title: 'Link',
    keywords: 'url href',
    group: 'Format',
    run: (c) => {
      const href = window.prompt('Link URL');
      if (!href) return;
      const { editor } = c.session;
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
      } else {
        editor.chain().focus().setLink({ href }).run();
      }
    },
  },
  { id: 'collapse-all', title: 'Collapse all', keywords: 'fold', group: 'Outline', run: (c) => setCollapsedUnder(c, true) },
  { id: 'expand-all', title: 'Expand all', keywords: 'unfold', group: 'Outline', run: (c) => setCollapsedUnder(c, false) },
  {
    id: 'zoom-in',
    title: 'Zoom in',
    keywords: 'focus open',
    group: 'Outline',
    run: (c) => {
      c.session.flush();
      c.navigate(`/n/${c.nodeId}`);
      c.ui.focusNode(c.nodeId, { kind: 'end' });
    },
  },
  {
    id: 'export-markdown',
    title: 'Export as Markdown',
    keywords: 'download md',
    group: 'Export',
    run: (c) => downloadText(exportName(c, 'md'), exportMarkdown(c.engine.tree, c.rootId), 'text/markdown'),
  },
  {
    id: 'export-opml',
    title: 'Export as OPML',
    keywords: 'download xml',
    group: 'Export',
    run: (c) => downloadText(exportName(c, 'opml'), exportOpml(c.engine.tree, c.rootId), 'text/xml'),
  },
  {
    id: 'export-json',
    title: 'Export JSON backup',
    keywords: 'download all',
    group: 'Export',
    run: (c) => downloadText(safeFilename('aletheia-backup', 'json'), exportJson(c.engine.tree), 'application/json'),
  },
  {
    id: 'import-markdown',
    title: 'Import Markdown into this node',
    keywords: 'upload md list',
    group: 'Import',
    run: (c) => importWith(c, '.md,.markdown,.txt,text/markdown,text/plain', parseMarkdownOutline),
  },
  {
    id: 'import-opml',
    title: 'Import OPML (WorkFlowy, Dynalist) into this node',
    keywords: 'upload xml workflowy dynalist',
    group: 'Import',
    run: (c) => importWith(c, '.opml,.xml,text/xml,text/x-opml', parseOpml),
  },
  {
    id: 'restore-backup',
    title: 'Restore JSON backup (replaces everything)',
    keywords: 'import json',
    group: 'Import',
    run: async (c) => {
      const text = await pickTextFile('.json,application/json');
      if (text === null) return;
      const nodes = parseBackup(text);
      if (!window.confirm(`Replace the whole outline with ${nodes.length} nodes from the backup?`)) return;
      c.ui.blur();
      await c.engine.replaceAll(nodes);
      c.search.rebuild();
      c.navigate('/');
    },
  },
  {
    id: 'tutorial',
    title: 'Tutorial',
    keywords: 'help guide shortcuts keyboard',
    group: 'Help',
    run: (c) => {
      c.session.flush();
      c.ui.blur();
      c.ui.setHelpOpen(true);
    },
  },
];

for (const command of defaultSlashCommands) registerSlashCommand(command);
