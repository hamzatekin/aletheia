interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

/** Chevron for nodes with children: on hover with a mouse, always on touch screens (as in WorkFlowy). */
export function CollapseToggle({ collapsed, onToggle }: Props) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      className={
        'collapse-toggle relative flex h-(--row-lh) w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100 ' +
        (collapsed ? 'text-muted' : 'text-faint')
      }
    >
      <svg
        width="10"
        height="10"
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
