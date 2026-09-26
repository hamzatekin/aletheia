interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

/** Chevron shown on hover for nodes with children. */
export function CollapseToggle({ collapsed, onToggle }: Props) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      className="flex h-(--row-lh) w-5 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
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
