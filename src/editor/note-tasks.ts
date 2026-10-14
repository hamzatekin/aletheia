import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { MarkdownIt } from 'markdown-it';
import { taskLists } from './task-list';

/**
 * Checklists in the rendered note editor, as on GitHub: "[ ] " or "[] " at the
 * start of a line (or of a bulleted item) makes a checkbox, "[x] " a ticked
 * one, Enter adds the next unticked item, Tab nests it. Saved as "- [ ] ".
 * Notes are read with the same task-list rule as rendered notes, so what the
 * editor loads matches what was shown (tiptap-markdown keeps its serializer).
 */
export const noteTaskExtensions = [
  TaskList.extend({
    // Like tiptap-markdown's tight bullet lists: items are saved without blank lines between them unless the list was loose.
    addAttributes() {
      return {
        tight: {
          default: true,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-tight') === 'true',
          renderHTML: (attributes: { tight?: boolean }) => (attributes.tight ? { 'data-tight': 'true' } : {}),
        },
      };
    },
    addStorage() {
      return { markdown: { parse: { setup: (md: MarkdownIt) => md.use(taskLists) } } };
    },
  }),
  TaskItem.extend({
    addStorage() {
      return { markdown: { parse: {} } };
    },
    // data-type: the item's own view leaves it out, and the shared styles need it.
  }).configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
];
