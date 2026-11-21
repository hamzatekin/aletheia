import { createSignal, Show } from 'solid-js';
import { useAppNavigate } from '@/app/routing';
import { HOME_LABEL } from '@/app/sandbox';
import { downloadText, pickTextFile, safeFilename } from '@/io/browser';
import { exportJson, exportMarkdown, exportOpml, parseBackup } from '@/io/export';
import { countItems, importAsTopNode, importTitle, parseMarkdownOutline, parseOpml } from '@/io/import';
import type { OutlineItem } from '@/io/types';
import { useOutline } from '@/tree-view/outline-context';
import { isWide } from '@/ui/media';
import { Button } from '@/ui/widgets';

/**
 * Import, export and backup: they act on the whole outline, so they live here
 * rather than in a node's menu or the "/" menu. An import lands as one new
 * item at the top of Home, named after the file, like WorkFlowy's import.
 */
export function DataSection() {
  const { engine, ui, session, search } = useOutline();
  const navigate = useAppNavigate();
  const [message, setMessage] = createSignal<{ text: string; error?: boolean } | null>(null);

  /** Show Home with the result; on a phone the drawer would cover it. */
  const showHome = () => {
    navigate('/');
    window.scrollTo(0, 0);
    if (!isWide()) ui.setSettingsOpen(false);
  };

  const importFile = async (accept: string, parse: (text: string) => OutlineItem[]) => {
    const file = await pickTextFile(accept);
    if (!file) return;
    let items: OutlineItem[];
    try {
      items = parse(file.text);
    } catch {
      return setMessage({ text: `Could not read ${file.name}.`, error: true });
    }
    if (items.length === 0) return setMessage({ text: `${file.name} has nothing to import.`, error: true });
    session.flush();
    ui.blur();
    if (!importAsTopNode(engine, importTitle(file.name, new Date()), items)) return setMessage({ text: 'Import failed.', error: true });
    const n = countItems(items);
    setMessage({ text: `Imported ${n} ${n === 1 ? 'item' : 'items'} at the top of ${HOME_LABEL}.` });
    showHome();
  };

  const restore = async () => {
    const file = await pickTextFile('.json,application/json');
    if (!file) return;
    let nodes;
    try {
      nodes = parseBackup(file.text);
    } catch {
      return setMessage({ text: `Could not read ${file.name}.`, error: true });
    }
    if (!window.confirm(`Replace the whole outline with ${nodes.length} nodes from the backup?`)) return;
    session.flush();
    ui.blur();
    await engine.replaceAll(nodes);
    search.rebuild();
    setMessage({ text: 'Backup restored.' });
    showHome();
  };

  const flushed = <T,>(f: () => T) => () => (session.flush(), f());

  return (
    <section data-testid="data-section" class="mt-4 border-t border-line pt-4">
      <h2 class="mb-2 font-semibold">Import & export</h2>
      <p class="mb-1.5 text-xs text-muted">Import a file as a new item at the top of {HOME_LABEL}.</p>
      <div class="mb-3 flex flex-wrap gap-2">
        <Button onClick={() => void importFile('.md,.markdown,.txt,text/markdown,text/plain', parseMarkdownOutline)}>Markdown</Button>
        <Button onClick={() => void importFile('.opml,.xml,text/xml,text/x-opml', parseOpml)}>OPML (WorkFlowy, Dynalist)</Button>
      </div>
      <p class="mb-1.5 text-xs text-muted">Download everything.</p>
      <div class="mb-3 flex flex-wrap gap-2">
        <Button onClick={flushed(() => downloadText(safeFilename('aletheia', 'md'), exportMarkdown(engine.tree, null), 'text/markdown'))}>Markdown</Button>
        <Button onClick={flushed(() => downloadText(safeFilename('aletheia', 'opml'), exportOpml(engine.tree, null), 'text/xml'))}>OPML</Button>
        <Button onClick={flushed(() => downloadText(safeFilename('aletheia-backup', 'json'), exportJson(engine.tree), 'application/json'))}>JSON backup</Button>
      </div>
      <p class="mb-1.5 text-xs text-muted">Restoring a JSON backup replaces everything.</p>
      <Button onClick={() => void restore()}>Restore backup</Button>
      <Show when={message()}>
        {(m) => (
          <p role="status" class={['mt-3 text-xs', m().error ? 'text-danger' : 'text-muted']}>
            {m().text}
          </p>
        )}
      </Show>
    </section>
  );
}
