import { useEffect, type RefObject } from 'react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';
import { plainText } from '@/editor/markdown';
import { canDropOn, DRAG_TYPE, isDragData, itemMode, resolveInstruction } from './dnd';
import { INDENT_PX } from './Row';
import { useOutline } from './outline-context';

/** Make the bullet (and the grip left of it) drag the node, and the row accept drops. */
export function useRowDnd(
  id: string,
  depth: number,
  rowRef: RefObject<HTMLElement | null>,
  handleRef: RefObject<HTMLElement | null>,
  gripRef?: RefObject<HTMLElement | null>,
): void {
  const { engine, ui, session } = useOutline();
  useEffect(() => {
    const row = rowRef.current;
    const handle = handleRef.current;
    if (!row || !handle) return;
    const handles = gripRef?.current ? [handle, gripRef.current] : [handle];
    const { tree } = engine;
    const showIndicator = (data: Record<string | symbol, unknown>) => {
      const instruction = extractInstruction(data);
      const resolved = instruction && resolveInstruction(tree, id, depth, instruction);
      ui.setDropIndicator(resolved ? resolved.indicator : null);
    };
    return combine(
      ...handles.map((element) =>
        draggable({
          element,
          getInitialData: () => ({ type: DRAG_TYPE, id }),
          onGenerateDragPreview: ({ nativeSetDragImage }) => {
            setCustomNativeDragPreview({
              nativeSetDragImage,
              getOffset: pointerOutsideOfPreview({ x: '8px', y: '8px' }),
              render: ({ container }) => {
                const el = document.createElement('div');
                el.className = 'drag-preview';
                el.textContent = plainText(tree.get(id)?.content ?? '') || 'Untitled';
                container.appendChild(el);
              },
            });
          },
          onDragStart: () => {
            session.flush();
            ui.blur();
            ui.setSelection(null);
            ui.setDragging(id);
          },
          onDrop: () => {
            ui.setDragging(null);
            ui.setDropIndicator(null);
          },
        })
      ),
      dropTargetForElements({
        element: row,
        canDrop: ({ source }) => isDragData(source.data) && canDropOn(tree, source.data.id, id),
        getData: ({ input, element }) =>
          attachInstruction({ id }, { input, element, currentLevel: depth, indentPerLevel: INDENT_PX, mode: itemMode(tree, id, depth) }),
        getIsSticky: () => true,
        onDragEnter: ({ self }) => showIndicator(self.data),
        onDrag: ({ self }) => showIndicator(self.data),
        onDragLeave: () => {
          // Leave of the previous row can arrive after enter of the next one.
          if (ui.getState().dropIndicator?.targetId === id) ui.setDropIndicator(null);
        },
      }),
    );
  }, [engine, ui, session, id, depth, rowRef, handleRef, gripRef]);
}

/** One monitor per page: turn the final drop instruction into a move. */
export function useDropMonitor(): void {
  const { engine, ui } = useOutline();
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isDragData(source.data),
        onDrop: ({ source, location }) => {
          ui.setDropIndicator(null);
          ui.setDragging(null);
          const target = location.current.dropTargets[0];
          if (!target || !isDragData(source.data)) return;
          const targetId = target.data.id as string;
          const instruction = extractInstruction(target.data);
          if (!instruction) return;
          const depth = Number(target.element.getAttribute('data-depth') ?? 0);
          const resolved = resolveInstruction(engine.tree, targetId, depth, instruction);
          if (!resolved) return;
          engine.execute(resolved.command(source.data.id));
        },
      }),
    [engine, ui],
  );
}
