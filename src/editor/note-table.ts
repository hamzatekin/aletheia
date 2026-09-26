import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Node as PMNode } from '@tiptap/pm/model';

interface SerializerState {
  inTable?: boolean;
  esc(text: string, startOfLine?: boolean): string;
  write(text: string): void;
  renderInline(node: PMNode): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
}

/**
 * GFM tables in the rendered note editor. A cell holds exactly one paragraph,
 * so every table the editor can produce is one Markdown can hold (Enter in a
 * cell does nothing rather than splitting it), and "|" typed in a cell is
 * escaped so it can't break the row.
 */
export const noteTableExtensions = [
  Table.extend({
    addStorage() {
      return {
        markdown: {
          serialize(state: SerializerState, node: PMNode) {
            const esc = state.esc;
            state.esc = (text, startOfLine) => esc.call(state, text, startOfLine).replace(/\|/g, '\\|');
            state.inTable = true;
            node.forEach((row, _offset, i) => {
              state.write('| ');
              row.forEach((cell, _o, j) => {
                if (j) state.write(' | ');
                if (cell.firstChild && cell.textContent.trim()) state.renderInline(cell.firstChild);
              });
              state.write(' |');
              state.ensureNewLine();
              if (i === 0) {
                state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`);
                state.ensureNewLine();
              }
            });
            state.closeBlock(node);
            state.inTable = false;
            state.esc = esc;
          },
          parse: {},
        },
      };
    },
  }).configure({ resizable: false, allowTableNodeSelection: false }),
  TableRow,
  TableHeader.extend({ content: 'paragraph' }),
  TableCell.extend({ content: 'paragraph' }),
];
