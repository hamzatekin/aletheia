import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { moveDownCommand, moveUpCommand } from '@/commands';
import { useUiStore } from '@/store/ui-store';
import { useOutline } from './outline-context';

const COARSE = '(pointer: coarse)';

function subscribeCoarse(onChange: () => void): () => void {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True on touch screens (phones, tablets), where there is no hover and no Tab key. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
}

/** Height of the on-screen keyboard (or anything else covering the bottom of the window). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * The bar above the phone keyboard while editing, like WorkFlowy's and
 * Dynalist's: the outline keys a phone keyboard lacks (Tab, Shift+Tab,
 * Alt+Shift+arrows), plus undo, the node menu and a button to stop editing.
 */
export function MobileToolbar() {
  const { engine, ui, session, actions, rootId } = useOutline();
  const coarse = useCoarsePointer();
  const focus = useUiStore(ui, (s) => s.focus);
  const menu = useUiStore(ui, (s) => s.menu);
  const inset = useKeyboardInset();
  if (!coarse || !focus) return null;

  const { id, field } = focus;
  const isTitle = id === rootId;
  const node = engine.tree.get(id);
  const canOutdent = !isTitle && node?.parentId !== rootId;

  const structural = (run: () => void) => () => {
    if (isTitle) return;
    session.flush();
    run();
  };

  const buttons: { id: string; label: string; disabled?: boolean; run(): void; icon: ReactNode }[] = [
    {
      id: 'outdent',
      label: 'Outdent',
      disabled: !canOutdent,
      run: structural(() => engine.execute({ type: 'outdent', id })),
      icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4" /></Icon>,
    },
    {
      id: 'indent',
      label: 'Indent',
      disabled: isTitle,
      run: structural(() => engine.execute({ type: 'indent', id })),
      icon: <Icon><path d="M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4" /></Icon>,
    },
    {
      id: 'move-up',
      label: 'Move up',
      disabled: isTitle,
      run: structural(() => {
        const cmd = moveUpCommand({ tree: engine.tree, now: 0 }, id);
        if (cmd) engine.execute(cmd);
      }),
      icon: <Icon><path d="M12 19V5M6 11l6-6 6 6" /></Icon>,
    },
    {
      id: 'move-down',
      label: 'Move down',
      disabled: isTitle,
      run: structural(() => {
        const cmd = moveDownCommand({ tree: engine.tree, now: 0 }, id);
        if (cmd) engine.execute(cmd);
      }),
      icon: <Icon><path d="M12 5v14M6 13l6 6 6-6" /></Icon>,
    },
    {
      id: 'note',
      label: field === 'note' ? 'Back to node' : 'Note',
      run: () => {
        session.flush();
        ui.focusNode(id, { kind: 'end' }, field === 'note' ? 'content' : 'note');
      },
      icon: <Icon><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" /></Icon>,
    },
    {
      id: 'undo',
      label: 'Undo',
      run: () => actions.undo(),
      icon: <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>,
    },
    {
      id: 'redo',
      label: 'Redo',
      run: () => actions.redo(),
      icon: <Icon><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>,
    },
    {
      id: 'more',
      label: 'More actions',
      disabled: isTitle,
      run: () => {
        // The menu hangs under the row; closing the keyboard keeps it on screen.
        session.flush();
        ui.blur();
        ui.setMenu(menu === id ? null : id);
      },
      icon: <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>,
    },
    {
      id: 'done',
      label: 'Done',
      run: () => {
        session.flush();
        ui.blur();
        (document.activeElement as HTMLElement | null)?.blur();
      },
      icon: <Icon><path d="m6 9 6 6 6-6" /></Icon>,
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      data-testid="mobile-toolbar"
      className="mobile-toolbar fixed inset-x-0 z-40 flex items-stretch justify-around border-t border-line bg-surface"
      style={{ bottom: inset, paddingBottom: inset === 0 ? 'env(safe-area-inset-bottom)' : 0 }}
      // Keep the editor (and the keyboard) while a button is tapped.
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          tabIndex={-1}
          aria-label={b.label}
          title={b.label}
          disabled={b.disabled}
          data-testid={`toolbar-${b.id}`}
          {...(b.id === 'more' ? { 'data-menu-for': id } : {})}
          className="flex h-11 min-w-0 flex-1 items-center justify-center text-muted active:bg-active disabled:opacity-30"
          onClick={b.run}
        >
          {b.icon}
        </button>
      ))}
    </div>
  );
}
