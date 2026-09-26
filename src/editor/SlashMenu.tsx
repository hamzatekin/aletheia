import { useOutline } from '@/tree-view/outline-context';
import { useUiStore } from '@/store/ui-store';
import { slashCommands } from './slash-registry';

/** Floating command list under the focused node while the slash query is open. */
export function SlashMenu() {
  const { ui, actions } = useOutline();
  const slash = useUiStore(ui, (s) => s.slash);
  if (!slash) return null;
  const items = slashCommands(slash.query);
  const index = Math.min(slash.index, Math.max(0, items.length - 1));
  return (
    <div
      role="listbox"
      aria-label="Commands"
      data-testid="slash-menu"
      className="absolute top-full left-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
    >
      {items.length === 0 && <div className="px-3 py-1.5 text-faint">No matching command</div>}
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === index}
          data-testid="slash-item"
          className={
            'flex cursor-pointer items-center justify-between px-3 py-1.5 ' +
            (i === index ? 'bg-active' : '')
          }
          onMouseDown={(e) => {
            e.preventDefault();
            actions.runSlash(i);
          }}
          onMouseEnter={() => ui.setSlash({ ...slash, index: i })}
        >
          <span>{item.title}</span>
          {item.group && <span className="ml-3 text-xs text-faint">{item.group}</span>}
        </div>
      ))}
    </div>
  );
}
