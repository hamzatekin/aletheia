import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { plainText } from '@/editor/markdown';
import { renderBlock } from '@/editor/render';
import { useTreeStore } from '@/store/tree-store';
import { useOutline } from '@/tree-view/outline-context';
import { SidebarIcon } from '@/tree-view/OutlineSidebar';
import { useEscToClose, useKeyboardInset } from '@/ui/hooks';
import { isWide } from '@/ui/media';
import { Spinner } from '@/ui/widgets';
import { linkCitations } from './prompt';
import type { AgentService, Turn } from './service';

/** A four-point sparkle: the icon for AI. */
function AiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" />
      <path d="M19 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z" />
    </svg>
  );
}

/** The top-right button that opens the AI chat. */
export function AgentButton({ agent }: { agent: AgentService }) {
  const { ui, session } = useOutline();
  const open = useStore(agent.state, (s) => s.open);
  const busy = useStore(agent.state, (s) => s.busy);
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (open) return agent.hide();
        session.flush();
        ui.blur();
        agent.show();
      }}
      className={'top-icon fixed top-3 right-43 z-40 flex size-[34px] items-center justify-center rounded-md hover:bg-hover hover:text-ink ' + (open ? 'bg-active text-ink' : 'text-muted')}
      aria-label="Ask AI"
      aria-expanded={open}
      title="Ask AI about your notes"
      data-testid="agent-button"
    >
      <AiIcon />
      {busy && !open && <span className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-accent" />}
    </button>
  );
}

/**
 * One AI chat for the whole app. It searches and opens rows by itself, and
 * adds, moves or edits rows when asked, starting from the row you're on.
 * Docked on the right on wide screens (like Settings), a sheet on phones.
 */
export function AgentPanel({ agent }: { agent: AgentService }) {
  const { engine } = useOutline();
  const navigate = useNavigate();
  const s = useStore(agent.state);
  // Titles shown here follow edits.
  useTreeStore(engine.store, (t) => t.version);
  const inset = useKeyboardInset();
  const panelRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  useEscToClose(s.open, panelRef, useCallback(() => agent.hide(), [agent]));

  const turns = s.turns.length;
  useEffect(() => {
    if (s.open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [s.open, turns, s.busy, s.steps.length]);

  if (!s.open) return null;
  const ai = agent.available();
  const here = agent.here();
  const title = (id: string) => plainText(engine.tree.get(id)?.content ?? '').trim() || 'Untitled';

  const go = (id: string) => {
    navigate(`/n/${id}`);
    if (!isWide()) agent.hide();
  };
  const send = () => {
    if (draft.trim() === '' || s.busy) return;
    setDraft('');
    void agent.ask(draft);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 lg:hidden" aria-hidden="true" onMouseDown={() => agent.hide()} />
      <aside
        ref={panelRef}
        aria-label="Ask AI"
        data-testid="agent-panel"
        className="side-panel z-50 flex flex-col text-sm text-ink shadow-xl lg:z-30 lg:shadow-none"
        style={inset > 0 ? { bottom: inset, maxHeight: `calc(100dvh - ${inset + 24}px)` } : undefined}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="flex-1 text-xs font-semibold tracking-wider text-muted uppercase">Ask AI</span>
          {turns > 0 && (
            <button type="button" onClick={() => agent.clear()} className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-ink" data-testid="agent-clear">
              New chat
            </button>
          )}
          <button type="button" onClick={() => agent.hide()} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Hide AI" title="Hide (Esc)">
            <SidebarIcon side="right" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {turns === 0 && !s.busy && (
            <p className="py-2 text-muted">
              {ai
                ? 'Ask anything about your notes. AI searches them by itself, and adds, moves or edits rows when you ask (one Undo takes it back). It starts from the row you’re on.'
                : 'Turn on sync in Settings to use AI on this device.'}
            </p>
          )}
          <div className="flex flex-col gap-3" data-testid="agent-chat">
            {s.turns.map((t, i) => (
              <Message
                key={i}
                turn={t}
                label={(n) => {
                  const id = t.rows?.[n - 1];
                  return id ? title(id) : null;
                }}
                onCite={(n) => {
                  const id = t.rows?.[n - 1];
                  if (id) go(id);
                }}
                onUndo={() => agent.undoChanges(i)}
              />
            ))}
            {s.busy && (
              <div className="flex flex-col gap-1 text-muted" role="status" data-testid="agent-steps">
                {s.steps.map((line, i) => (
                  <div key={i} className="text-xs">
                    {line}
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Spinner /> Thinking…
                </div>
              </div>
            )}
            {s.error && <p className="text-danger" role="alert">{s.error}</p>}
          </div>
          <div ref={endRef} />
        </div>

        {ai && (
          <div className="border-t border-line px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mb-1.5 truncate px-0.5 text-xs text-faint" data-testid="agent-here">
              {here ? `On: ${title(here)}` : 'On: Home'}
            </div>
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Ask about your notes…"
                aria-label="Ask AI"
                className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-line bg-transparent px-2.5 py-1.5 text-base outline-none focus:border-accent sm:text-sm"
                data-testid="agent-input"
              />
              <button type="submit" disabled={s.busy || draft.trim() === ''} className="h-9 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-page disabled:opacity-40">
                Ask
              </button>
            </form>
          </div>
        )}
      </aside>
    </>
  );
}

/** A chat message. Answers show their citations as jumps to the rows, and what AI changed, with Undo. */
function Message({ turn, label, onCite, onUndo }: { turn: Turn; label(n: number): string | null; onCite(n: number): void; onUndo(): void }) {
  if (turn.role === 'user') {
    return <div className="ml-8 self-end rounded-lg bg-selection px-3 py-2 break-words whitespace-pre-wrap">{turn.text}</div>;
  }
  const short = (n: number) => {
    const l = label(n);
    return l === null ? null : l.length > 28 ? `${l.slice(0, 27)}…` : l;
  };
  const html = renderBlock(linkCitations(turn.text, short));
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const m = a?.getAttribute('href')?.match(/^#cite-(\d+)$/);
    if (!m) return;
    e.preventDefault();
    onCite(Number(m[1]));
  };
  return (
    <div data-testid="agent-answer">
      <div className="prose-note agent-answer break-words" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {turn.did && (
        <div className="mt-1.5 text-xs text-muted" data-testid="agent-did">
          {turn.did.map((line, i) => (
            <div key={i} className={turn.undone ? 'line-through' : undefined}>
              {line}
            </div>
          ))}
          {turn.undone ? (
            <div className="mt-1">Undone.</div>
          ) : (
            turn.undoable && (
              <button type="button" onClick={onUndo} className="mt-1 font-medium text-accent hover:underline">
                Undo
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
