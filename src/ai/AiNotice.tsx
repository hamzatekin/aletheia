import { Show } from 'solid-js';
import { useStoreValue } from '@/ui/store';
import { Spinner, TOP_BANNER } from '@/ui/widgets';
import type { AiService } from './service';

/** A small bar at the top of the page: AI is working, what it did (with Undo), or why it failed. */
export function AiNotice(props: { ai: AiService }) {
  const notice = useStoreValue(props.ai.state, (s) => s.notice);
  return (
    <Show when={notice()}>
      {(n) => (
        <div
          role={n().kind === 'error' ? 'alert' : 'status'}
          data-testid="ai-notice"
          class={TOP_BANNER}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show when={n().kind === 'busy'}>
            <Spinner />
          </Show>
          <span class={['min-w-0 truncate', { 'text-danger': n().kind === 'error' }]}>{n().text}</span>
          <Show when={n().action}>
            {(a) => (
              <button type="button" data-testid="ai-notice-action" class="shrink-0 font-medium underline" onClick={() => a().run()}>
                {a().label}
              </button>
            )}
          </Show>
          <Show when={n().kind !== 'busy'}>
            <button type="button" aria-label="Dismiss" class="shrink-0 text-faint hover:text-ink" onClick={() => props.ai.dismiss()}>
              ×
            </button>
          </Show>
        </div>
      )}
    </Show>
  );
}
