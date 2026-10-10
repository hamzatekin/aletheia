import { useRef, type MouseEvent, type RefObject, type TouchEvent } from 'react';
import { Link } from 'react-router';

/** How long a finger stays on a bullet before its menu opens; the same as a long press on a row. */
const LONG_PRESS_MS = 450;

interface Props {
  id: string;
  collapsedWithChildren: boolean;
  handleRef?: RefObject<HTMLAnchorElement | null>;
  /**
   * Touch screens: a tap still zooms in, and a long press opens the node's
   * menu, as in WorkFlowy's app. The arrow at the row's right end folds it.
   */
  menu?: { open: boolean; show(): void } | undefined;
}

/** The bullet: clicking zooms into the node, a long press on a phone opens its menu, dragging moves it. Collapsed parents get a halo. */
export function Bullet({ id, collapsedWithChildren, handleRef, menu }: Props) {
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  const touch = menu && {
    onTouchStart: (e: TouchEvent<HTMLAnchorElement>) => {
      cancel();
      press.current = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const timer = window.setTimeout(() => {
        if (!press.current) return;
        press.current.fired = true;
        navigator.vibrate?.(10);
        menu.show();
      }, LONG_PRESS_MS);
      press.current = { timer, x: t.clientX, y: t.clientY, fired: false };
    },
    onTouchMove: (e: TouchEvent<HTMLAnchorElement>) => {
      const p = press.current;
      const t = e.touches[0];
      if (p && t && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 10) cancel();
    },
    onTouchEnd: (e: TouchEvent<HTMLAnchorElement>) => {
      cancel();
      // The press opened the menu: lifting the finger must not also zoom in, or land on the menu's backdrop.
      if (press.current?.fired && e.cancelable) e.preventDefault();
    },
    onTouchCancel: cancel,
    // The long press is ours; Android would offer to open or copy the link.
    onContextMenu: (e: MouseEvent<HTMLAnchorElement>) => e.preventDefault(),
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (!press.current?.fired) return;
      e.preventDefault();
      press.current = null;
    },
  };

  return (
    <Link
      ref={handleRef}
      to={`/n/${id}`}
      aria-label="Zoom in"
      {...(menu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu.open } : {})}
      {...touch}
      className="group/bullet flex h-(--row-lh) w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
    >
      <span
        className={
          'bullet-dot block rounded-full bg-muted transition-[box-shadow] ' +
          (collapsedWithChildren ? 'bullet-collapsed' : '')
        }
      />
    </Link>
  );
}
