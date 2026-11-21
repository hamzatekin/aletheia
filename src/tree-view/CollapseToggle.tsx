interface Props {
  collapsed: boolean;
  onToggle: () => void;
  /** Touch screens put it at the row's right edge, always shown, like WorkFlowy's phone app. */
  side?: 'left' | 'right';
  /** Keep the left arrow shown without hovering (on the focused row, beside its grip). */
  shown?: boolean;
}

/** Chevron for nodes with children: left of the bullet on hover with a mouse, at the right edge on touch screens. */
export function CollapseToggle(props: Props) {
  const right = () => props.side === 'right';
  return (
    <button
      type="button"
      tabindex={-1}
      aria-label={props.collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={props.collapsed ? 'false' : 'true'}
      onClick={() => props.onToggle()}
      onMouseDown={(e) => e.preventDefault()}
      class={[
        right()
          ? 'collapse-toggle-right relative -mr-3 flex h-(--row-lh) w-11 shrink-0 items-center justify-center rounded active:bg-active'
          : ['row-toggle relative flex h-(--row-lh) w-5 shrink-0 items-center justify-center rounded transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100', props.shown ? 'opacity-100' : 'opacity-0'],
        props.collapsed ? 'text-muted' : 'text-faint',
      ]}
    >
      <svg
        width={right() ? 14 : 10}
        height={right() ? 14 : 10}
        viewBox="0 0 10 10"
        fill="currentColor"
        aria-hidden="true"
        class={['transition-transform', { '-rotate-90': props.collapsed }]}
      >
        <path d="M1.5 3 L5 7 L8.5 3 Z" />
      </svg>
    </button>
  );
}
