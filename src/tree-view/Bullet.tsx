import type { RefObject } from 'react';
import { Link } from 'react-router';

interface Props {
  id: string;
  collapsedWithChildren: boolean;
  handleRef?: RefObject<HTMLAnchorElement | null>;
  /**
   * Touch screens: a tap opens the node's menu instead of zooming (Zoom in is
   * its first item). The arrow at the row's right end already folds it.
   */
  menu?: { open: boolean; toggle(): void } | undefined;
}

/** The bullet: clicking zooms into the node (on phones, opens its menu), dragging moves it. Collapsed parents get a halo. */
export function Bullet({ id, collapsedWithChildren, handleRef, menu }: Props) {
  return (
    <Link
      ref={handleRef}
      to={`/n/${id}`}
      aria-label={menu ? 'Node menu' : 'Zoom in'}
      {...(menu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu.open, 'data-menu-for': id, 'data-testid': 'bullet-menu' } : {})}
      onClick={
        menu
          ? (e) => {
              e.preventDefault();
              menu.toggle();
            }
          : undefined
      }
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
