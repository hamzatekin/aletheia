import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { plainText } from '@/editor/markdown';
import { renderBlock, renderInline } from '@/editor/render';
import { useTreeStore } from '@/store/tree-store';
import { useKeyboardInset } from '@/tree-view/MobileToolbar';
import { useOutline } from '@/tree-view/outline-context';
import { SidebarIcon } from '@/tree-view/OutlineSidebar';
import type { RelatedItem } from './find';
import { pathText } from './find';
import { linkCitations } from './prompts';
import type { RelatedService, Turn } from './service';

const WIDE = '(min-width: 1024px)';

/** One-tap questions: the actions the panel offers, as prompts for the same chat. */
const QUICK: { label: string; question: string }[] = [
  { label: 'Next steps', question: 'What should I do next on this? Give 3 to 5 concrete to-dos as bullets, based on this item and the related rows.' },
  { label: 'What do I know?', question: 'Sum up what my notes already say about this, in a few bullets.' },
  { label: 'Duplicates?', question: 'Do any of these rows repeat this item or each other? Say which, and how you would merge them.' },
];

function Spinner() {
  return <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-transparent" aria-hidden="true" />;
}

/** Three linked dots: the icon for related items. */
export function RelatedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="19" cy="5" r="2.2" />
      <circle cx="19" cy="19" r="2.2" />
      <path d="m7 11 10-5M7 13l10 5" />
    </svg>
  );
}

/** The top-right button that opens the panel, with how many related rows were found. */
export function RelatedButton({ related }: { related: RelatedService }) {
  const { ui, session } = useOutline();
  const open = useStore(related.state, (s) => s.open);
  // Recount whenever the matches change.
  useStore(related.state, (s) => s.text);
  useStore(related.state, (s) => s.ai);
  const count = related.target() ? related.shown().main.length : 0;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (open) return related.hide();
        session.flush();
        ui.blur();
        related.show();
      }}
      className={'top-icon fixed top-3 right-43 z-40 flex size-[34px] items-center justify-center rounded-md hover:bg-hover hover:text-ink ' + (open ? 'bg-active text-ink' : 'text-muted')}
      aria-label={count > 0 ? `Related (${count})` : 'Related'}
      aria-expanded={open}
      title="Related: what else in your notes is about this"
      data-testid="related-button"
    >
      <RelatedIcon />
      {count > 0 && !open && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-page" data-testid="related-count">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * What else in your notes is about the item you're on, and help acting on it.
 * Docked on the right on wide screens (like Settings), a sheet from the bottom
 * on phones. Text matches show at once; AI adds rows related by meaning, and
 * answers questions about the item and those rows.
 */
export function RelatedPanel({ related }: { related: RelatedService }) {
  const { engine } = useOutline();
  const navigate = useNavigate();
  const s = useStore(related.state);
  // Titles and notes shown here follow edits.
  useTreeStore(engine.store, (t) => t.version);
  const inset = useKeyboardInset();
  const panelRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [peek, setPeek] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (window.matchMedia(WIDE).matches && !panelRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      related.hide();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [s.open, related]);

  const turns = s.chat.turns.length;
  useEffect(() => {
    if (turns > 0) endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, s.chat.busy]);

  if (!s.open) return null;
  const id = related.target();
  const item = id ? engine.tree.get(id) : undefined;
  const ai = related.aiAvailable();
  const { main, more } = related.shown();
  // AI is still to answer for this row: show where results will land rather than word matches that would then move.
  const looking = ai && (s.ai.status === 'idle' || s.ai.status === 'busy');
  const title = (rid: string) => plainText(engine.tree.get(rid)?.content ?? '').trim() || 'Untitled';

  const go = (rid: string) => {
    navigate(`/n/${rid}`);
    if (!window.matchMedia(WIDE).matches) related.hide();
  };
  const send = (question: string, label?: string) => {
    if (question.trim() === '' || s.chat.busy) return;
    if (label === undefined) setDraft('');
    void related.ask(question, label);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 lg:hidden" aria-hidden="true" onMouseDown={() => related.hide()} />
      <aside
        ref={panelRef}
        aria-label="Related"
        data-testid="related-panel"
        className="related-panel z-50 flex flex-col text-sm text-ink shadow-xl lg:z-30 lg:shadow-none"
        style={inset > 0 ? { bottom: inset, maxHeight: `calc(100dvh - ${inset + 24}px)` } : undefined}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">Related</span>
          {item && <span className="min-w-0 flex-1 truncate text-muted" data-testid="related-target">to {title(id!)}</span>}
          {!item && <span className="flex-1" />}
          <button type="button" onClick={() => related.hide()} className="rounded p-1 text-muted hover:bg-hover hover:text-ink" aria-label="Hide related" title="Hide (Esc)">
            <SidebarIcon side="right" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {!item ? (
            <p className="py-2 text-muted">Zoom into an item, or pick Related from an item's ≡ menu, to see what else in your notes is about it.</p>
          ) : (
            <>
              {main.length === 0 && (looking ? <Skeleton /> : <p className="py-2 text-muted">Nothing else in your notes seems to be about this yet.</p>)}
              <ul className="-mx-2" data-testid="related-list">
                {[...main, ...(showMore ? more : [])].map((r) => (
                  <Result
                    key={r.id}
                    item={r}
                    path={pathText(engine.tree, r.id)}
                    open={peek === r.id}
                    moved={s.moved.has(r.id)}
                    onPeek={() => setPeek(peek === r.id ? null : r.id)}
                    onGo={() => go(r.id)}
                    onPull={() => related.pullHere(r.id)}
                    onUndo={() => related.undoPull(r.id)}
                  />
                ))}
              </ul>
              {more.length > 0 && (
                <button type="button" onClick={() => setShowMore(!showMore)} className="mt-1 text-xs text-muted hover:text-ink" data-testid="related-more">
                  {showMore ? 'Hide rows that only share words' : `${more.length} more ${more.length === 1 ? 'row shares' : 'rows share'} words with it`}
                </button>
              )}
              <AiStatus related={related} ai={ai} />

              {(turns > 0 || s.chat.busy || s.chat.error) && <div className="my-3 border-t border-line" />}
              <div className="flex flex-col gap-3" data-testid="related-chat">
                {s.chat.turns.map((t, i) => (
                  <Message
                    key={i}
                    turn={t}
                    label={(n) => (n === 0 ? title(id!) : t.rows?.[n - 1] ? title(t.rows[n - 1]!) : null)}
                    onCite={(n) => {
                      const rid = n === 0 ? id! : t.rows?.[n - 1];
                      if (rid) go(rid);
                    }}
                    onInsert={() => related.insertAnswer(i)}
                    onUndo={() => related.undoInsert(i)}
                  />
                ))}
                {s.chat.busy && (
                  <div className="flex items-center gap-2 text-muted" role="status">
                    <Spinner /> Thinking…
                  </div>
                )}
                {s.chat.error && <p className="text-danger" role="alert">{s.chat.error}</p>}
              </div>
              <div ref={endRef} />
            </>
          )}
        </div>

        {item && ai && (
          <div className="border-t border-line px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={s.chat.busy}
                  onClick={() => send(q.question, q.label)}
                  className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-hover hover:text-ink disabled:opacity-50"
                  data-testid="related-quick"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={1}
                placeholder="Ask about this…"
                aria-label="Ask about this item"
                className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-line bg-transparent px-2.5 py-1.5 text-base outline-none focus:border-accent sm:text-sm"
                data-testid="related-input"
              />
              <button
                type="submit"
                disabled={s.chat.busy || draft.trim() === ''}
                className="h-9 shrink-0 rounded-md bg-accent px-3 text-sm font-medium text-page disabled:opacity-40"
              >
                Ask
              </button>
            </form>
          </div>
        )}
      </aside>
    </>
  );
}

/** A related row: its text and where it lives; tap to peek at its note and what's under it. */
function Result({ item, path, open, moved, onPeek, onGo, onPull, onUndo }: {
  item: RelatedItem;
  path: string;
  open: boolean;
  moved: boolean;
  onPeek(): void;
  onGo(): void;
  onPull(): void;
  onUndo(): void;
}) {
  const { engine } = useOutline();
  const node = engine.tree.get(item.id);
  if (!node) return null;
  const kids = engine.tree.children(item.id);
  const onTitle = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) return; // let links open
    onPeek();
  };
  return (
    <li className="rounded-md px-2 py-2 hover:bg-hover" data-testid="related-item" data-id={item.id}>
      <div className="cursor-pointer" onClick={onTitle} aria-expanded={open}>
        <div className="flex items-start gap-2">
          <span className="line-clamp-3 min-w-0 flex-1 text-[0.95rem] leading-snug break-words" dangerouslySetInnerHTML={{ __html: renderInline(node.content) || 'Untitled' }} />
          {item.duplicate && <span className="shrink-0 rounded bg-selection px-1.5 text-[11px] leading-5 text-accent">Duplicate?</span>}
        </div>
        {path !== '' && <div className="truncate text-xs text-faint">{path}</div>}
        {item.why && <div className="mt-0.5 text-xs text-muted">{item.why}</div>}
      </div>
      {open && (
        <div className="mt-2 border-l-2 border-line pl-2.5 text-[0.9rem]" data-testid="related-peek">
          {node.note.trim() !== '' && <div className="prose-note mb-1" dangerouslySetInnerHTML={{ __html: renderBlock(node.note) }} />}
          {kids.length > 0 ? (
            <ul className="list-disc pl-4 text-muted">
              {kids.slice(0, 8).map((k) => (
                <li key={k} dangerouslySetInnerHTML={{ __html: renderInline(engine.tree.get(k)?.content ?? '') || '&nbsp;' }} />
              ))}
              {kids.length > 8 && <li className="list-none text-faint">and {kids.length - 8} more</li>}
            </ul>
          ) : (
            node.note.trim() === '' && <p className="text-faint">Nothing under it.</p>
          )}
        </div>
      )}
      <div className="mt-1.5 flex gap-3 text-xs">
        {moved ? (
          <>
            <span className="text-muted">Moved here.</span>
            <LinkButton onClick={onUndo}>Undo</LinkButton>
          </>
        ) : (
          <>
            <LinkButton onClick={onGo}>Go there</LinkButton>
            <LinkButton onClick={onPull} title="Move it, with what's under it, to the end of this item">Move here</LinkButton>
          </>
        )}
      </div>
    </li>
  );
}

function LinkButton({ children, onClick, title }: { children: ReactNode; onClick(): void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="font-medium text-accent hover:underline">
      {children}
    </button>
  );
}

/** Grey rows where the results will appear, while AI looks. */
function Skeleton() {
  return (
    <div className="py-1" role="status" aria-label="Finding related items" data-testid="related-skeleton">
      {[0.85, 0.6, 0.75].map((w, i) => (
        <div key={i} className="mb-4 animate-pulse">
          <div className="mb-1.5 h-3.5 rounded bg-active" style={{ width: `${w * 100}%` }} />
          <div className="mb-1.5 h-2.5 w-1/3 rounded bg-active" />
          <div className="h-2.5 w-1/2 rounded bg-active" />
        </div>
      ))}
    </div>
  );
}

/** How the search by meaning is going, or why it can't run here. */
function AiStatus({ related, ai }: { related: RelatedService; ai: boolean }) {
  const found = useStore(related.state, (s) => s.ai);
  if (!ai) return <p className="mt-2 text-xs text-faint">Turn on sync in Settings to also find items related by meaning and ask AI about this.</p>;
  if (found.status === 'busy' && found.items.length > 0)
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted" role="status" data-testid="related-busy">
        <Spinner /> Looking again…
      </p>
    );
  if (found.status !== 'done' && found.status !== 'error') return null;
  if (found.status === 'error')
    return (
      <p className="mt-2 text-xs text-danger" role="alert">
        {found.error} <LinkButton onClick={() => void related.findMore(true)}>Try again</LinkButton>
      </p>
    );
  if (found.status === 'done')
    return (
      <p className="mt-2 text-xs text-faint">
        <LinkButton onClick={() => void related.findMore(true)}>Look again</LinkButton>
      </p>
    );
  return null;
}

/** A chat message. Answers show their citations as jumps to the rows, and can be added to the outline. */
function Message({ turn, label, onCite, onInsert, onUndo }: {
  turn: Turn;
  label(n: number): string | null;
  onCite(n: number): void;
  onInsert(): void;
  onUndo(): void;
}) {
  if (turn.role === 'user') {
    return <div className="ml-8 self-end rounded-lg bg-selection px-3 py-2 break-words whitespace-pre-wrap">{turn.label ?? turn.text}</div>;
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
    <div data-testid="related-answer">
      <div className="prose-note related-answer break-words" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      <div className="mt-1 flex gap-3 text-xs">
        {turn.added ? (
          <>
            <span className="text-muted">Added {turn.added.length === 1 ? '1 item' : `${turn.added.length} items`} to the outline.</span>
            <LinkButton onClick={onUndo}>Undo</LinkButton>
          </>
        ) : (
          <LinkButton onClick={onInsert}>Add to outline</LinkButton>
        )}
      </div>
    </div>
  );
}
