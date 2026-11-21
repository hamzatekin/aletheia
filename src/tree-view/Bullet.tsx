import { createSignal } from 'solid-js';
import { appPath } from '@/app/routing';
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
  /** Called with the bullet's link element (the drag handle, see use-dnd.ts). */
  handleRef?: (el: HTMLAnchorElement) => void;
  /**
   * Touch screens: a tap still zooms in, and a long press opens the node's
   * menu, as in WorkFlowy's app. The arrow at the row's right end folds it.
   */
  menu?: { open: boolean; show(): void } | undefined;
}

/** The bullet: clicking zooms into the node, a long press on a phone opens its menu, dragging moves it. Collapsed parents get a halo. */
export function Bullet(props: Props) {
  let press: { timer: number; x: number; y: number; fired: boolean } | null = null;
  const [pressed, setPressed] = createSignal(false);
  const { navigate } = useOutline();
  const cancel = () => {
    if (press) clearTimeout(press.timer);
  };

  // The touch handlers only do something while `menu` is given (phones); the bindings themselves are fixed, so each checks.
  const onTouchStart = (e: TouchEvent) => {
    const menu = props.menu;
    if (!menu) return;
    cancel();
    press = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    setPressed(true);
    const timer = window.setTimeout(() => {
      if (!press) return;
      press.fired = true;
      setPressed(false);
      navigator.vibrate?.(10);
      menu.show();
    }, LONG_PRESS_MS);
    press = { timer, x: t.clientX, y: t.clientY, fired: false };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!props.menu) return;
    const p = press;
    const t = e.touches[0];
    if (p && t && Math.hypot(t.clientX - p.x, t.clientY - p.y) > LONG_PRESS_SLOP_PX) {
      cancel();
      setPressed(false);
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!props.menu) return;
    cancel();
    // The press opened the menu: lifting the finger must not also zoom in, or land on the menu's backdrop.
    if (press?.fired && e.cancelable) e.preventDefault();
    // A tap keeps the halo until its click zooms in; a click may not follow (a scroll, a drag), so let go anyway.
    window.setTimeout(() => setPressed(false), PRESS_SHOW_MS + 300);
  };
  const onTouchCancel = () => {
    if (!props.menu) return;
    cancel();
    setPressed(false);
  };
  // The long press is ours; Android would offer to open or copy the link.
  const onContextMenu = (e: MouseEvent) => {
    if (props.menu) e.preventDefault();
  };
  const onClick = (e: MouseEvent) => {
    if (!props.menu) {
      // Through the page's navigate, so zooming in animates.
      if (!plainClick(e)) return;
      e.preventDefault();
      navigate(`/n/${props.id}`);
      return;
    }
    if (press?.fired) {
      e.preventDefault();
      press = null;
      return;
    }
    if (!pressed() || e.metaKey || e.ctrlKey || e.shiftKey) return;
    // Show the press once the finger is off the bullet, then zoom in.
    e.preventDefault();
    window.setTimeout(() => {
      setPressed(false);
      navigate(`/n/${props.id}`);
    }, PRESS_SHOW_MS);
  };

  return (
    <a
      ref={(el) => props.handleRef?.(el)}
      href={appPath(`/n/${props.id}`)}
      noscroll
      aria-label="Zoom in"
      aria-haspopup={props.menu ? 'menu' : undefined}
      aria-expanded={props.menu ? (props.menu.open ? 'true' : 'false') : undefined}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={onContextMenu}
      onClick={onClick}
      data-pressed={pressed() ? '' : undefined}
      class="group/bullet flex h-(--row-lh) w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
    >
      <span
        class={['bullet-dot block rounded-full bg-muted transition-[box-shadow]', { 'bullet-collapsed': props.collapsedWithChildren }]}
      />
    </a>
  );
}
