import { useStore } from 'zustand';
import { Spinner, TOP_BANNER } from '@/ui/widgets';
import type { AiService } from './service';

/** A small bar at the top of the page: AI is working, what it did (with Undo), or why it failed. */
export function AiNotice({ ai }: { ai: AiService }) {
  const notice = useStore(ai.state, (s) => s.notice);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      data-testid="ai-notice"
      className={TOP_BANNER}
      onMouseDown={(e) => e.preventDefault()}
    >
      {notice.kind === 'busy' && <Spinner />}
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
