import { useStore } from 'zustand';
import type { AiService } from './service';

/** A small bar at the top of the page: AI is working, what it did (with Undo), or why it failed. */
export function AiNotice({ ai }: { ai: AiService }) {
  const notice = useStore(ai.state, (s) => s.notice);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-testid="ai-notice"
      className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {notice.kind === 'busy' && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-transparent" aria-hidden="true" />}
      <span className={'min-w-0 truncate ' + (notice.kind === 'error' ? 'text-danger' : '')}>{notice.text}</span>
      {notice.action && (
        <button type="button" data-testid="ai-notice-action" className="shrink-0 font-medium underline" onClick={notice.action.run}>
          {notice.action.label}
        </button>
      )}
      {notice.kind !== 'busy' && (
        <button type="button" aria-label="Dismiss" className="shrink-0 text-faint hover:text-ink" onClick={() => ai.dismiss()}>
          ×
        </button>
      )}
    </div>
  );
}
