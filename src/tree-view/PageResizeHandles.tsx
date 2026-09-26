import { useState, type PointerEvent } from 'react';
import { DEFAULT_SETTINGS, LIMITS, useSettings, type SettingsStore } from '@/store/settings-store';

interface Props {
  settings: SettingsStore;
}

/**
 * Drag either side of the page to change its width (the page stays centered,
 * so the width changes by twice the drag). Double-click resets it.
 */
export function PageResizeHandles({ settings }: Props) {
  const shape = useSettings(settings, (s) => s.pageShape);
  const [dragging, setDragging] = useState(false);
  const key = shape === 'landscape' ? 'landscapeWidth' : 'pageWidth';
  const limits = LIMITS[key];

  const onPointerDown = (side: -1 | 1) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const page = e.currentTarget.parentElement!;
    const startX = e.clientX;
    const startWidth = page.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => {
      const raw = startWidth + side * 2 * (ev.clientX - startX);
      const width = Math.round(Math.min(limits.max, Math.max(limits.min, raw)) / limits.step) * limits.step;
      if (settings.getState()[key] !== width) settings.getState().update({ [key]: width });
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => settings.getState().update({ [key]: DEFAULT_SETTINGS[key] });

  return (
    <>
      {([-1, 1] as const).map((side) => (
        <div
          key={side}
          role="separator"
          aria-orientation="vertical"
          aria-label={side === -1 ? 'Resize page from the left' : 'Resize page from the right'}
          title="Drag to resize the page, double-click to reset"
          data-testid={side === -1 ? 'page-resize-left' : 'page-resize-right'}
          onPointerDown={onPointerDown(side)}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={reset}
          className={
            'group/resize absolute inset-y-0 z-10 hidden w-3 cursor-ew-resize touch-none sm:block ' + (side === -1 ? 'left-0' : 'right-0')
          }
        >
          <span
            className={
              'absolute inset-y-0 w-0.5 bg-faint transition-opacity ' +
              (side === -1 ? 'left-0' : 'right-0') +
              (dragging ? ' opacity-100' : ' opacity-0 group-hover/resize:opacity-100')
            }
          />
        </div>
      ))}
    </>
  );
}
