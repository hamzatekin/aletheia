import type { Editor } from '@tiptap/core';
import { registerSlashCommand, type SlashCommand } from './slash-registry';

function insertLink(editor: Editor): void {
  const href = window.prompt('Link URL');
  if (!href) return;
  if (editor.state.selection.empty) {
    editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  } else {
    editor.chain().focus().setLink({ href }).run();
  }
}

/**
 * What "/" inserts, like WorkFlowy's slash menu: text formats everywhere, and
 * block formats in notes (a node's own line is a single line of text).
 */
const defaultSlashCommands: SlashCommand[] = [
  { id: 'bold', title: 'Bold', keywords: 'strong', group: 'Format', run: (c) => c.editor.chain().focus().toggleBold().run() },
  { id: 'italic', title: 'Italic', keywords: 'emphasis', group: 'Format', run: (c) => c.editor.chain().focus().toggleItalic().run() },
  { id: 'strike', title: 'Strikethrough', keywords: 'strike done cross', group: 'Format', run: (c) => c.editor.chain().focus().toggleStrike().run() },
  { id: 'code', title: 'Inline code', keywords: 'code monospace', group: 'Format', run: (c) => c.editor.chain().focus().toggleCode().run() },
  { id: 'link', title: 'Link', keywords: 'url href', group: 'Format', run: (c) => insertLink(c.editor) },
  { id: 'text', title: 'Text', keywords: 'paragraph plain normal', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().setParagraph().run() },
  ...([1, 2, 3] as const).map(
    (level): SlashCommand => ({
      id: `h${level}`,
      title: `Heading ${level}`,
      keywords: `h${level} title header`,
      group: 'Block',
      fields: ['note'],
      run: (c) => c.editor.chain().focus().setHeading({ level }).run(),
    }),
  ),
  { id: 'bullets', title: 'Bulleted list', keywords: 'ul unordered list', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().toggleBulletList().run() },
  { id: 'numbers', title: 'Numbered list', keywords: 'ol ordered list', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().toggleOrderedList().run() },
  { id: 'quote', title: 'Quote', keywords: 'blockquote', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().toggleBlockquote().run() },
  { id: 'code-block', title: 'Code block', keywords: 'code fence pre', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().toggleCodeBlock().run() },
  {
    id: 'table',
    title: 'Table',
    keywords: 'grid columns',
    group: 'Block',
    fields: ['note'],
    run: (c) => c.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'divider', title: 'Divider', keywords: 'hr rule line separator', group: 'Block', fields: ['note'], run: (c) => c.editor.chain().focus().setHorizontalRule().run() },
];

for (const command of defaultSlashCommands) registerSlashCommand(command);
