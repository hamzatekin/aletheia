interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Touch screens put it at the row's right edge, always shown, like WorkFlowy's phone app. */
  side?: 'left' | 'right';
}

/** Chevron for nodes with children: left of the bullet on hover with a mouse, at the right edge on touch screens. */
export function CollapseToggle({ collapsed, onToggle, side = 'left' }: Props) {
  const right = side === 'right';
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      className={
        (right
          ? 'collapse-toggle-right relative -mr-3 flex h-(--row-lh) w-11 shrink-0 items-center justify-center rounded active:bg-active '
          : 'relative flex h-(--row-lh) w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 ') +
        (collapsed ? 'text-muted' : 'text-faint')
      }
    >
      <svg
        width={right ? 14 : 10}
        height={right ? 14 : 10}
        viewBox="0 0 10 10"
        fill="currentColor"
        aria-hidden="true"
        className={'transition-transform ' + (collapsed ? '-rotate-90' : '')}
      >
        <path d="M1.5 3 L5 7 L8.5 3 Z" />
      </svg>
    </button>
  );
}
