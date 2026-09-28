import { registerSlashCommand } from '@/editor/slash-registry';
import type { AiService } from './service';

/** The AI entries of the "/" menu, shown only where AI is available (sync on). */
export function registerAiSlashCommands(ai: AiService): void {
  registerSlashCommand({
    id: 'ai-title',
    title: 'Suggest title',
    keywords: 'ai claude name summarize',
    group: 'AI',
    available: () => ai.available(),
    run: (c) => ai.suggestTitle(c.nodeId),
  });
}
