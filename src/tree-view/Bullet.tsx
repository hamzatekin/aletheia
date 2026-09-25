import { Link } from 'react-router';

interface Props {
  id: string;
  collapsedWithChildren: boolean;
}

/** The bullet: clicking zooms into the node. Collapsed parents get a halo. */
export function Bullet({ id, collapsedWithChildren }: Props) {
  return (
    <Link
      to={`/n/${id}`}
      aria-label="Zoom in"
      draggable={false}
      className="group/bullet flex h-6 w-5 shrink-0 items-center justify-center rounded-full"
    >
      <span
        className={
          'block h-1.5 w-1.5 rounded-full bg-neutral-500 transition-[box-shadow] dark:bg-neutral-400 ' +
          (collapsedWithChildren
            ? 'shadow-[0_0_0_4px] shadow-neutral-200 dark:shadow-neutral-700'
            : 'group-hover/bullet:shadow-[0_0_0_4px] group-hover/bullet:shadow-neutral-100 dark:group-hover/bullet:shadow-neutral-800')
        }
      />
    </Link>
  );
}
