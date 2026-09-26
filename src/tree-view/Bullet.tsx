import type { RefObject } from 'react';
import { Link } from 'react-router';

interface Props {
  id: string;
  collapsedWithChildren: boolean;
  handleRef?: RefObject<HTMLAnchorElement | null>;
}

/** The bullet: clicking zooms into the node, dragging moves it. Collapsed parents get a halo. */
export function Bullet({ id, collapsedWithChildren, handleRef }: Props) {
  return (
    <Link
      ref={handleRef}
      to={`/n/${id}`}
      aria-label="Zoom in"
      className="group/bullet flex h-(--row-lh) w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
    >
      <span
        className={
          'block size-[5px] rounded-full bg-muted transition-[box-shadow] ' +
          (collapsedWithChildren
            ? 'shadow-[0_0_0_4px] shadow-halo'
            : 'group-hover/bullet:shadow-[0_0_0_4px] group-hover/bullet:shadow-halo-soft')
        }
      />
    </Link>
  );
}
