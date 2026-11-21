import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { useUiStore, type UiStore } from '@/store/ui-store';
import { asParts, keyParts, TABS, type Block, type Inline, type Mark } from './tutorial-content';

interface Props {
  ui: UiStore;
}

/** A key combo like "Mod+Shift+Enter", drawn as keycaps. */
function Keys(props: { k: string }) {
  return (
    <span class="inline-flex flex-wrap items-center gap-1 whitespace-nowrap">
      <For each={keyParts(props.k)}>
        {(part) => (
          <kbd class="min-w-6 rounded border border-b-2 border-line bg-hover px-1.5 py-0.5 text-center font-mono text-xs text-ink">{part}</kbd>
        )}
      </For>
    </span>
  );
}

function renderPart(m: string | Mark): JSX.Element {
  if (typeof m === 'string') return m;
  if ('keys' in m) return <Keys k={m.keys} />;
  if ('code' in m) return <code class="rounded bg-active px-1 py-0.5 font-mono text-[0.85em]">{m.code}</code>;
  if ('bold' in m) return <b>{m.bold}</b>;
  if ('italic' in m) return <i>{m.italic}</i>;
  return <s>{m.strike}</s>;
}

const renderInline = (n: Inline): JSX.Element => asParts(n).map(renderPart);

function renderBlock(b: Block): JSX.Element {
  if ('h' in b) return <h3 class="mt-1 mb-2 text-sm font-semibold">{b.h}</h3>;
  if ('p' in b) return <p class="mb-4 text-sm leading-relaxed text-muted">{renderInline(b.p)}</p>;
  return (
    <table class="mb-5 w-full text-sm">
      <tbody>
        <For each={b.table}>
          {([a, c]) => (
            <tr class="border-b border-line last:border-0">
              <td class="w-[45%] py-2 pr-3 align-top">{renderInline(a)}</td>
              <td class="py-2 align-top text-muted">{renderInline(c)}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** A tabbed guide to every shortcut and hidden feature. */
export function TutorialDialog(props: Props) {
  const open = useUiStore(props.ui, (s) => s.helpOpen);
  const [tab, setTab] = createSignal(TABS[0]!.id);
  const current = createMemo(() => TABS.find((t) => t.id === tab()) ?? TABS[0]!);
  let closeEl: HTMLButtonElement | undefined;

  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return;
      closeEl?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.ui.setHelpOpen(false);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    },
  );

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.ui.setHelpOpen(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tutorial"
          data-testid="tutorial"
          class="flex h-[min(38rem,calc(100vh-1.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface text-ink shadow-2xl sm:flex-row"
        >
          <nav
            class="tabs-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-48 sm:flex-col sm:border-r sm:border-b-0 sm:p-3"
            role="tablist"
            aria-label="Tutorial topics"
          >
            <div class="hidden px-2 pb-2 text-xs font-semibold tracking-wider text-muted uppercase sm:block">Tutorial</div>
            <For each={TABS}>
              {(t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === current().id ? 'true' : 'false'}
                  onClick={(e) => {
                    setTab(t.id);
                    e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  }}
                  class={['shrink-0 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap', t.id === current().id ? 'bg-active font-medium' : 'text-muted hover:bg-hover']}
                >
                  {t.title}
                </button>
              )}
            </For>
          </nav>
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 class="text-lg font-semibold">{current().title}</h2>
              <button
                ref={(e) => (closeEl = e)}
                type="button"
                onClick={() => props.ui.setHelpOpen(false)}
                class="rounded p-1 text-muted hover:bg-hover hover:text-ink"
                aria-label="Close tutorial"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5" role="tabpanel">
              <For each={current().body}>{(b) => renderBlock(b)}</For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
