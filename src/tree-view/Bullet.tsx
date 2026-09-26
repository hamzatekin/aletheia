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
      className="group/bullet flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
    >
      <span
        className={
          'block size-[5px] rounded-full bg-neutral-500 transition-[box-shadow] dark:bg-neutral-400 ' +
          (collapsedWithChildren
            ? 'shadow-[0_0_0_4px] shadow-neutral-200 dark:shadow-neutral-700'
            : 'group-hover/bullet:shadow-[0_0_0_4px] group-hover/bullet:shadow-neutral-100 dark:group-hover/bullet:shadow-neutral-800')
        }
      />
    </Link>
  );
}
