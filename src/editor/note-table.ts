import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

interface SerializerState {
  inTable?: boolean;
  esc(text: string, startOfLine?: boolean): string;
  write(text: string): void;
  renderInline(node: PMNode): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
}

/** A column's alignment (":---:" in Markdown), kept on each of its cells. */
function aligned(this: { parent: (() => object) | undefined }) {
  return {
    ...this.parent?.(),
    align: {
      default: null,
      parseHTML: (element: HTMLElement) => element.style.textAlign || null,
      renderHTML: (attributes: { align?: string | null }) => (attributes.align ? { style: `text-align: ${attributes.align}` } : {}),
    },
  };
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
            // A cell's text never starts a line, so "-3" or "1. x" in a cell needs no escaping.
            state.esc = (text) => esc.call(state, text, false).replace(/\|/g, '\\|');
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
                const rule = (cell: PMNode) => ({ left: ':---', center: ':---:', right: '---:' })[cell.attrs.align as string] ?? '---';
                state.write(`| ${Array.from({ length: row.childCount }, (_, j) => rule(row.child(j))).join(' | ')} |`);
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
  TableHeader.extend({ content: 'paragraph', addAttributes: aligned }),
  TableCell.extend({ content: 'paragraph', addAttributes: aligned }),
];

/**
 * Enter in a table, which can't split a cell: at the very start of the table
 * it opens a new line above it, anywhere in its last row a new line below it
 * (as in Word and Google Docs), so a note that is only a table can still grow.
 * Elsewhere in the table Enter does nothing.
 */
export function lineBesideTable(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection;
  const depth = tableDepth($from);
  if (depth === 0) return false;
  const table = $from.node(depth);
  const row = $from.index(depth);
  const atStart = empty && row === 0 && $from.index(depth + 1) === 0 && $from.parentOffset === 0;
  if (!atStart && row !== table.childCount - 1) return true;
  const pos = atStart ? $from.before(depth) : $from.after(depth);
  if (dispatch) {
    const tr = state.tr.insert(pos, state.schema.nodes.paragraph!.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
  }
  return true;
}

/**
 * Arrow up from a table's first row, or down from its last, onto the gap
 * cursor before or after it, when no text is there to move to. Typing or
 * Enter there starts a new line.
 */
export function gapBesideTable(state: EditorState, dir: 1 | -1, dispatch?: (tr: Transaction) => void): boolean {
  const { $from } = state.selection;
  const depth = tableDepth($from);
  if (depth === 0 || $from.index(depth) !== (dir > 0 ? $from.node(depth).childCount - 1 : 0)) return false;
  const $gap = state.doc.resolve(dir > 0 ? $from.after(depth) : $from.before(depth));
  // Text, a list or a quote beside the table: the arrow simply moves into it.
  const beside = dir > 0 ? $gap.nodeAfter : $gap.nodeBefore;
  if (beside && beside.type.name !== 'table' && !beside.isAtom) return false;
  dispatch?.(state.tr.setSelection(new GapCursor($gap)).scrollIntoView());
  return true;
}

/** Depth of the table around `$pos`, 0 when outside one. */
function tableDepth($pos: ResolvedPos): number {
  let depth = $pos.depth;
  while (depth > 0 && $pos.node(depth).type.name !== 'table') depth--;
  return depth;
}
