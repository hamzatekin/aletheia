import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { addedLabel } from '@/app/capture';
import { useAppNavigate } from '@/app/routing';
import { plainText } from '@/editor/markdown';
import { renderBlock } from '@/editor/render';
import { useTreeStore } from '@/store/tree-store';
import { useOutline } from '@/tree-view/outline-context';
import { SidebarIcon } from '@/tree-view/OutlineSidebar';
import { useEscToClose, useKeyboardInset } from '@/ui/hooks';
import { isWide } from '@/ui/media';
import { useStoreValue } from '@/ui/store';
import { Spinner } from '@/ui/widgets';
import { chatTitle, MAX_CHATS } from './chats';
import { linkCitations } from './prompt';
import type { AgentService, Turn } from './service';

/** A four-point sparkle: the icon for AI. */
function AiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" />
      <path d="M19 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z" />
    </svg>
  );
}

/** The top-right button that opens the AI chat. */
export function AgentButton(props: { agent: AgentService }) {
  const { ui, session } = useOutline();
  const open = useStoreValue(props.agent.state, (s) => s.open);
  const busy = useStoreValue(props.agent.state, (s) => s.busy);
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (open()) return props.agent.hide();
        session.flush();
        ui.blur();
        props.agent.show();
      }}
      class={['top-icon fixed top-3 right-43 z-40 flex size-[34px] items-center justify-center rounded-md hover:bg-hover hover:text-ink', open() ? 'bg-active text-ink' : 'text-muted']}
      aria-label="Ask AI"
      aria-expanded={open() ? 'true' : 'false'}
      title="Ask AI about your notes"
      data-testid="agent-button"
    >
      <AiIcon />
      <Show when={busy() && !open()}>
        <span class="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-accent" />
      </Show>
    </button>
  );
}

/**
 * One AI chat for the whole app. It searches and opens rows by itself, and
 * adds, moves or edits rows when asked, starting from the row you're on.
 * Docked on the right on wide screens (like Settings), a sheet on phones.
 */
export function AgentPanel(props: { agent: AgentService }) {
  const { engine } = useOutline();
  const navigate = useAppNavigate();
  const state = props.agent.state;
  const open = useStoreValue(state, (s) => s.open);
  const busy = useStoreValue(state, (s) => s.busy);
  const chatId = useStoreValue(state, (s) => s.chatId);
  const chats = useStoreValue(state, (s) => s.chats);
  const turnList = useStoreValue(state, (s) => s.turns);
  const turns = useStoreValue(state, (s) => s.turns.length);
  const steps = useStoreValue(state, (s) => s.steps);
  const stepCount = useStoreValue(state, (s) => s.steps.length);
  const error = useStoreValue(state, (s) => s.error);
  // Titles shown here follow edits.
  const version = useTreeStore(engine.store, (t) => t.version);
  const inset = useKeyboardInset();
  let panelRef: HTMLElement | undefined;
  let endRef: HTMLDivElement | undefined;
  const [draft, setDraft] = createSignal('');
  /** Showing Recent chats instead of the chat. */
  const [recent, setRecent] = createSignal(false);

  useEscToClose(open, () => panelRef, () => props.agent.hide());

  createEffect(
    () => [open(), recent(), chatId(), turns(), busy(), stepCount()] as const,
    ([isOpen, showingRecent]) => {
      if (isOpen && !showingRecent) endRef?.scrollIntoView({ block: 'end' });
    },
  );

  // Follows sync turning on or off (main.tsx's key reads sync's store).
  const ai = () => props.agent.available();
  // The row or page questions start from, while it still exists.
  const start = useStoreValue(state, (s) => s.row ?? s.pageRoot);
  const here = createMemo(() => {
    start();
    version();
    return props.agent.here();
  });
  const title = (id: string) => {
    version();
    return plainText(engine.tree.get(id)?.content ?? '').trim() || 'Untitled';
  };

  const go = (id: string) => {
    navigate(`/n/${id}`);
    if (!isWide()) props.agent.hide();
  };
  const send = () => {
    const text = draft();
    if (text.trim() === '' || busy()) return;
    setDraft('');
    void props.agent.ask(text);
  };
  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    send();
  };

  return (
    <Show when={open()}>
      <div class="fixed inset-0 z-50 bg-black/20 lg:hidden" aria-hidden="true" onMouseDown={() => props.agent.hide()} />
      <aside
        ref={(e) => (panelRef = e)}
        aria-label="Ask AI"
        data-testid="agent-panel"
        class="side-panel z-50 flex flex-col text-sm text-ink shadow-xl lg:z-30 lg:shadow-none"
        style={inset() > 0 ? { bottom: `${inset()}px`, 'max-height': `calc(100dvh - ${inset() + 24}px)` } : undefined}
      >
        <div class="flex items-center gap-2 px-4 pt-4 pb-2">
          <span class="flex-1 text-xs font-semibold tracking-wider text-muted uppercase">{recent() ? 'Recent chats' : 'Ask AI'}</span>
          <Show when={chats().length > 0 && !busy()}>
            <button
              type="button"
              onClick={() => setRecent(!recent())}
              class={['rounded px-1.5 py-0.5 text-xs hover:bg-hover hover:text-ink', recent() ? 'bg-active text-ink' : 'text-muted']}
              aria-pressed={recent() ? 'true' : 'false'}
              data-testid="agent-recent"
            >
              Recent
            </button>
          </Show>
          <Show when={turns() > 0 || recent()}>
            <button
              type="button"
              onClick={() => {
                props.agent.clear();
                setRecent(false);
              }}
              class="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-ink"
              data-testid="agent-clear"
            >
              New chat
            </button>
          </Show>
          <button type="button" onClick={() => props.agent.hide()} class="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Hide AI" title="Hide (Esc)">
            <SidebarIcon side="right" />
          </button>
        </div>

        <Show
          when={recent()}
          fallback={
            <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <Show when={turns() === 0 && !busy()}>
                <p class="py-2 text-muted">
                  {ai()
                    ? 'Ask anything about your notes. AI searches them by itself, and adds, moves or edits rows when you ask (one Undo takes it back). It starts from the row you’re on.'
                    : 'Turn on sync in Settings to use AI on this device.'}
                </p>
              </Show>
              <Show when={turns() === 0 && !busy() && ai()}>
                <button
                  type="button"
                  onClick={() => void props.agent.myWeek()}
                  class="mb-2 rounded-full border border-line px-3 py-1 text-sm text-ink hover:bg-hover"
                  title="What you added and finished in the last 7 days, and what still waits in your Inbox"
                  data-testid="agent-my-week"
                >
                  My week
                </button>
              </Show>
              <div class="flex flex-col gap-3" data-testid="agent-chat">
                {/* By position, as the chat is: a turn that changes (Undo) keeps its row, and its open list. */}
                <For each={turnList()} keyed={false}>
                  {(t, i) => (
                    <Message
                      turn={t()}
                      label={(n) => {
                        const id = t().rows?.[n - 1];
                        return id ? title(id) : null;
                      }}
                      onCite={(n) => {
                        const id = t().rows?.[n - 1];
                        if (id) go(id);
                      }}
                      onUndo={() => props.agent.undoChanges(i)}
                    />
                  )}
                </For>
                <Show when={busy()}>
                  <div class="flex flex-col gap-1 text-muted" role="status" data-testid="agent-steps">
                    <For each={steps()} keyed={false}>
                      {(line) => <div class="text-xs">{line()}</div>}
                    </For>
                    <div class="flex items-center gap-2">
                      <Spinner /> Thinking…
                    </div>
                  </div>
                </Show>
                <Show when={error()}>
                  {(e) => (
                    <p class="text-danger" role="alert">
                      {e()}
                    </p>
                  )}
                </Show>
              </div>
              <div ref={(e) => (endRef = e)} />
            </div>
          }
        >
          <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4" data-testid="agent-chats">
            <For each={chats()}>
              {(c) => (
                <button
                  type="button"
                  onClick={() => {
                    props.agent.openChat(c.id);
                    setRecent(false);
                  }}
                  class={['flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left hover:bg-hover', { 'bg-active': c.id === chatId() }]}
                  aria-current={c.id === chatId() ? 'true' : undefined}
                >
                  <span class="min-w-0 flex-1 truncate">{chatTitle(c)}</span>
                  <span class="shrink-0 text-xs text-faint">{addedLabel(c.at, { short: !isWide() })}</span>
                </button>
              )}
            </For>
            <p class="px-2 pt-2 text-xs text-faint">The last {MAX_CHATS} chats are kept on this device.</p>
          </div>
        </Show>

        <Show when={ai() && !recent()}>
          <div class="border-t border-line px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div class="mb-1.5 truncate px-0.5 text-xs text-faint" data-testid="agent-here">
              {here() ? `On: ${title(here()!)}` : 'On: Home'}
            </div>
            <form onSubmit={onSubmit} class="flex items-end gap-2">
              <textarea
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask about your notes…"
                aria-label="Ask AI"
                class="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-line bg-transparent px-2.5 py-1.5 text-base outline-none focus:border-accent sm:text-sm"
                data-testid="agent-input"
              />
              <button type="submit" disabled={busy() || draft().trim() === ''} class="h-9 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-page disabled:opacity-40">
                Ask
              </button>
            </form>
          </div>
        </Show>
      </aside>
    </Show>
  );
}

/** A chat message. Answers show their citations as jumps to the rows, and what AI changed, with Undo. */
function Message(props: { turn: Turn; label(n: number): string | null; onCite(n: number): void; onUndo(): void }) {
  return (
    <Show when={props.turn.role !== 'user'} fallback={<div class="ml-8 self-end rounded-lg bg-selection px-3 py-2 break-words whitespace-pre-wrap">{props.turn.text}</div>}>
      <Answer turn={props.turn} label={props.label} onCite={props.onCite} onUndo={props.onUndo} />
    </Show>
  );
}

function Answer(props: { turn: Turn; label(n: number): string | null; onCite(n: number): void; onUndo(): void }) {
  const short = (n: number) => {
    const l = props.label(n);
    return l === null ? null : l.length > 28 ? `${l.slice(0, 27)}…` : l;
  };
  const html = createMemo(() => renderBlock(linkCitations(props.turn.text, short)));
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const m = a?.getAttribute('href')?.match(/^#cite-(\d+)$/);
    if (!m) return;
    e.preventDefault();
    props.onCite(Number(m[1]));
  };
  return (
    <div data-testid="agent-answer">
      <div class="prose-note agent-answer break-words" onClick={onClick} innerHTML={html()} />
      <Show when={props.turn.did || props.turn.skipped}>
        <Changes turn={props.turn} onUndo={props.onUndo} />
      </Show>
    </div>
  );
}

/** What AI changed, folded to one line with Undo; open it to see each change. */
function Changes(props: { turn: Turn; onUndo(): void }) {
  const did = () => props.turn.did ?? [];
  const count = () => (did().length === 0 ? 'No changes' : did().length === 1 ? '1 change' : `${did().length} changes`);
  const skipped = () => {
    const n = props.turn.skipped;
    return n ? ` (${n} skipped: ${n === 1 ? 'it names' : 'they name'} rows AI couldn't find)` : '';
  };
  return (
    <details class="group mt-1.5 text-xs text-muted" data-testid="agent-did">
      <summary class="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <svg class="size-3 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="m4.5 3 3 3-3 3" />
        </svg>
        <span class={props.turn.undone ? 'line-through' : undefined}>
          {count()}
          {skipped()}
        </span>
        <Show
          when={props.turn.undone}
          fallback={
            <Show when={props.turn.undoable}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault(); // don't open or close the list
                  props.onUndo();
                }}
                class="font-medium text-accent hover:underline"
              >
                Undo
              </button>
            </Show>
          }
        >
          <span>Undone.</span>
        </Show>
      </summary>
      <div class="mt-1 pl-5">
        <For each={did()} keyed={false}>
          {(line) => <div class={props.turn.undone ? 'line-through' : undefined}>{line()}</div>}
        </For>
      </div>
    </details>
  );
}
