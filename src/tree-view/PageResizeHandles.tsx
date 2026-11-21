import { createSignal } from 'solid-js';
import { DEFAULT_SETTINGS, LIMITS, useSettings, type SettingsStore } from '@/store/settings-store';

interface Props {
  settings: SettingsStore;
}

/**
 * Drag either side of the page to change its width (the page stays centered,
 * so the width changes by twice the drag). Double-click resets it.
 */
export function PageResizeHandles(props: Props) {
  const shape = useSettings(props.settings, (s) => s.pageShape);
  const [dragging, setDragging] = createSignal(false);
  const key = () => (shape() === 'landscape' ? 'landscapeWidth' : 'pageWidth');

  const onPointerDown = (side: -1 | 1) => (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { settings } = props;
    const k = key();
    const limits = LIMITS[k];
    const page = e.currentTarget.parentElement!;
    const startX = e.clientX;
    const startWidth = page.getBoundingClientRect().width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const raw = startWidth + side * 2 * (ev.clientX - startX);
      const width = Math.round(Math.min(limits.max, Math.max(limits.min, raw)) / limits.step) * limits.step;
      if (settings.getState()[k] !== width) settings.getState().update({ [k]: width });
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

  const reset = () => props.settings.getState().update({ [key()]: DEFAULT_SETTINGS[key()] });

  return (
    <>
      {([-1, 1] as const).map((side) => (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={side === -1 ? 'Resize page from the left' : 'Resize page from the right'}
          title="Drag to resize the page, double-click to reset"
          data-testid={side === -1 ? 'page-resize-left' : 'page-resize-right'}
          onPointerDown={onPointerDown(side)}
          onMouseDown={(e) => e.stopPropagation()}
          onDblClick={reset}
          class={['group/resize absolute inset-y-0 z-10 hidden w-3 cursor-ew-resize touch-none sm:block', side === -1 ? 'left-0' : 'right-0']}
        >
          <span class={['absolute inset-y-0 w-0.5 bg-faint transition-opacity', side === -1 ? 'left-0' : 'right-0', dragging() ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100']} />
        </div>
      ))}
    </>
  );
}
