import { moveDownCommand, moveUpCommand, type Command } from '@/commands';
import { clipboardItems, readClipboardText, subtreeItems, writeClipboard, writeClipboardData } from '@/io/clipboard';
import { importCommands, parseMarkdownOutline } from '@/io/import';
import type { OutlineItem } from '@/io/types';
import type { TreeReader } from '@/model';
import type { ActionContext } from './context';

export type SelectionAction = 'indent' | 'outdent' | 'moveUp' | 'moveDown' | 'delete' | 'copy' | 'cut' | 'paste' | 'done';

/** Whole-node selection: picking nodes, and acting on the picked ones. */
export function selectionActions(ctx: ActionContext) {
  const { engine, ui, session, rootId, tree } = ctx;
  const { selectRange } = ctx;

  const selectNode = (id: string) => {
    if (id === rootId || !tree.get(id)) return;
    session.flush();
    ui.blur();
    ui.setMenu(null);
    ui.setSelection({ anchor: id, head: id, ids: new Set([id]) });
  };

  const selectTo = (id: string) => {
    const { focus, selection } = ui.getState();
    const anchor = selection?.anchor ?? (focus && focus.id !== rootId ? focus.id : null);
    if (anchor === null) return selectNode(id);
    session.flush();
    ui.blur();
    selectRange(anchor, id);
  };

  const toggleSelected = (id: string) => {
    const { focus, selection } = ui.getState();
    const ids = new Set(selection?.ids ?? (focus && focus.id !== rootId ? [focus.id] : []));
    session.flush();
    ui.blur();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    if (ids.size === 0) return ui.setSelection(null);
    const head = ids.has(id) ? id : [...ids][ids.size - 1]!;
    ui.setSelection({ anchor: ids.has(selection?.anchor ?? '') ? selection!.anchor : head, head, ids });
  };

  /** Selected nodes whose parent is not selected, in visible order. */
  const topLevelSelected = (ids: ReadonlySet<string>): string[] =>
    ctx
      .rowsNow()
      .map((r) => r.id)
      .filter((id) => ids.has(id) && !ids.has(tree.get(id)?.parentId ?? ''));

  /** Select these sibling subtrees (after a paste): their rows, from the first to the last one's last visible descendant. */
  const reselect = (ids: string[]) => {
    const rows = ctx.rowsNow();
    const first = rows.findIndex((r) => r.id === ids[0]);
    let last = rows.findIndex((r) => r.id === ids[ids.length - 1]);
    if (first < 0 || last < 0) return ui.setSelection(null);
    const depth = rows[last]!.depth;
    while (rows[last + 1] && rows[last + 1]!.depth > depth) last++;
    selectRange(rows[first]!.id, rows[last]!.id);
  };

  const deleteSelected = (ids: ReadonlySet<string>) => {
    const top = topLevelSelected(ids);
    const outcome = engine.batch(top.map((id): Command => ({ type: 'deleteSubtree', id })), 'deleteSelection');
    ui.setSelection(null);
    // Keep selecting where the nodes were, as Dynalist does, unless on a phone where the bar would linger.
    if (outcome.ok && outcome.focus && !matchMedia('(pointer: coarse)').matches) selectRange(outcome.focus.id, outcome.focus.id);
  };

  /** Copy (or cut) the selection into a clipboard event. Returns false when nothing is selected. */
  const copySelection = (data: DataTransfer | null, cut = false): boolean => {
    const { focus, selection } = ui.getState();
    if (focus || !selection) return false;
    const items = subtreeItems(tree, topLevelSelected(selection.ids));
    if (items.length === 0) return false;
    if (data) writeClipboardData(data, items);
    else void writeClipboard(items);
    if (cut) deleteSelected(selection.ids);
    return true;
  };

  const pasteItems = (items: OutlineItem[]) => {
    const { selection } = ui.getState();
    if (!selection || items.length === 0) return;
    const top = topLevelSelected(selection.ids);
    const after = top[top.length - 1];
    const anchor = after !== undefined ? tree.get(after) : undefined;
    if (!anchor) return;
    const commands = importCommands(anchor.parentId, items, after);
    const outcome = engine.batch(commands, 'paste');
    if (!outcome.ok) return;
    // Select what was pasted: the created nodes whose parent is the anchor's.
    reselect(commands.flatMap((c) => (c.type === 'createNode' && c.parentId === anchor.parentId ? [c.id] : [])));
  };

  /** Paste below the selection. Returns false when nothing is selected. */
  const pasteIntoSelection = (text: string, json?: string | null): boolean => {
    const { focus, selection } = ui.getState();
    if (focus || !selection) return false;
    const items = clipboardItems(text, json) ?? parseMarkdownOutline(text);
    pasteItems(items);
    return true;
  };

  const selectionAction = (action: SelectionAction) => {
    const { selection } = ui.getState();
    if (!selection) return;
    const { ids } = selection;
    const top = topLevelSelected(ids);
    switch (action) {
      case 'moveUp':
      case 'moveDown': {
        const ordered = action === 'moveUp' ? top : [...top].reverse();
        const make = action === 'moveUp' ? moveUpCommand : moveDownCommand;
        engine.batch(ordered.map((id) => (t: TreeReader) => make({ tree: t, now: 0 }, id)), 'moveSelection');
        return;
      }
      case 'indent':
        engine.batch(top.map((id): Command => ({ type: 'indent', id })), 'indentSelection');
        return;
      case 'outdent': {
        const items = [...top].reverse().filter((id) => tree.get(id)?.parentId !== rootId);
        engine.batch(items.map((id): Command => ({ type: 'outdent', id })), 'outdentSelection');
        return;
      }
      case 'delete':
        deleteSelected(ids);
        return;
      case 'copy':
      case 'cut':
        copySelection(null, action === 'cut');
        return;
      case 'paste':
        void readClipboardText().then((text) => {
          if (text !== '') pasteIntoSelection(text);
        });
        return;
      case 'done':
        ui.setSelection(null);
        return;
    }
  };

  return { selectNode, selectTo, toggleSelected, selectionAction, copySelection, pasteIntoSelection };
}

export type SelectionActions = ReturnType<typeof selectionActions>;
