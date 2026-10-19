import { useRef, useState, type MouseEvent, type RefObject, type TouchEvent } from 'react';
import { Link } from 'react-router';
import { plainClick } from '@/ui/media';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from './layout';
import { useOutline } from './outline-context';

/**
 * After a tap, the pressed halo stays this long before zooming in. The finger
 * hides the bullet while it is down, so without it the press is never seen.
 */
const PRESS_SHOW_MS = 90;

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
  const [pressed, setPressed] = useState(false);
  const { navigate } = useOutline();
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  const touch = menu && {
    onTouchStart: (e: TouchEvent<HTMLAnchorElement>) => {
      cancel();
      press.current = null;
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      setPressed(true);
      const timer = window.setTimeout(() => {
        if (!press.current) return;
        press.current.fired = true;
        setPressed(false);
        navigator.vibrate?.(10);
        menu.show();
      }, LONG_PRESS_MS);
      press.current = { timer, x: t.clientX, y: t.clientY, fired: false };
    },
    onTouchMove: (e: TouchEvent<HTMLAnchorElement>) => {
      const p = press.current;
      const t = e.touches[0];
      if (p && t && Math.hypot(t.clientX - p.x, t.clientY - p.y) > LONG_PRESS_SLOP_PX) {
        cancel();
        setPressed(false);
      }
    },
    onTouchEnd: (e: TouchEvent<HTMLAnchorElement>) => {
      cancel();
      // The press opened the menu: lifting the finger must not also zoom in, or land on the menu's backdrop.
      if (press.current?.fired && e.cancelable) e.preventDefault();
      // A tap keeps the halo until its click zooms in; a click may not follow (a scroll, a drag), so let go anyway.
      window.setTimeout(() => setPressed(false), PRESS_SHOW_MS + 300);
    },
    onTouchCancel: () => {
      cancel();
      setPressed(false);
    },
    // The long press is ours; Android would offer to open or copy the link.
    onContextMenu: (e: MouseEvent<HTMLAnchorElement>) => e.preventDefault(),
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (press.current?.fired) {
        e.preventDefault();
        press.current = null;
        return;
      }
      if (!pressed || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Show the press once the finger is off the bullet, then zoom in.
      e.preventDefault();
      window.setTimeout(() => {
        setPressed(false);
        void navigate(`/n/${id}`);
      }, PRESS_SHOW_MS);
    },
  };

  return (
    <Link
      ref={handleRef}
      to={`/n/${id}`}
      aria-label="Zoom in"
      {...(menu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu.open } : {})}
      {...(touch ?? {
        // Through the page's navigate, so zooming in animates.
        onClick: (e: MouseEvent<HTMLAnchorElement>) => {
          if (!plainClick(e)) return;
          e.preventDefault();
          void navigate(`/n/${id}`);
        },
      })}
      {...(pressed ? { 'data-pressed': '' } : {})}
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
