import { createSignal, Show } from 'solid-js';
import { useFlash } from '@/ui/hooks';
import { Button } from '@/ui/widgets';
import { createKey, mcpCommand, setupCommand } from './claude-code';

/**
 * Under Sync: set up a computer for Claude Code. The /aletheia skill adds
 * items here; the MCP connection lets it search and read the notes.
 */
export function ClaudeCodeSection(props: { syncKey: string }) {
  return (
    <div data-testid="claude-code" class="mt-4">
      <h3 class="mb-1 text-xs font-semibold">Claude Code</h3>
      <KeyCommand
        intro="Run /aletheia in Claude Code to save its answer here, under Work › today's date."
        button="Set up Claude Code"
        label="Setup command"
        after="It saves a key that can only add items, and installs the skill. Setting up again turns this key off."
        make={async () => setupCommand(window.location.origin, await createKey(props.syncKey, 'capture'), Intl.DateTimeFormat().resolvedOptions().timeZone)}
      />
      <KeyCommand
        intro="Let Claude Code search and read your notes, so you can ask about them in the terminal."
        button="Connect to your notes"
        label="Connect command"
        after="It gives Claude Code a key that can only read, for all your projects (Passwords and Budget stay out). Connecting again turns this key off."
        make={async () => mcpCommand(window.location.origin, await createKey(props.syncKey, 'read'), Intl.DateTimeFormat().resolvedOptions().timeZone)}
        testId="claude-code-mcp"
      />
    </div>
  );
}

/** A button that makes a key and shows the command to run with it, ready to copy. */
function KeyCommand(props: { intro: string; button: string; label: string; after: string; make(): Promise<string>; testId?: string }) {
  const [command, setCommand] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [copied, flashCopied] = useFlash(2000);

  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setCommand(await props.make());
    } catch (error) {
      setProblem(error instanceof TypeError ? 'Could not reach the sync server. Are you online?' : (error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const text = command()!;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied();
    } catch {
      window.prompt('Copy this command', text);
    }
  };

  return (
    <div class="mb-3" data-testid={props.testId}>
      <p class="mb-2 text-xs text-muted">{props.intro}</p>
      <Show
        when={command()}
        fallback={
          <Button disabled={busy()} onClick={() => void setUp()}>
            {props.button}
          </Button>
        }
      >
        {(cmd) => (
          <>
            <p class="mb-1.5 text-xs text-muted">Run this once in a terminal on your computer:</p>
            <textarea
              readonly
              value={cmd()}
              rows={4}
              aria-label={props.label}
              onFocus={(e) => e.currentTarget.select()}
              class="mb-2 block w-full resize-none rounded border border-line bg-transparent px-2 py-1 font-mono text-xs text-muted"
            />
            <div class="mb-2 flex gap-2">
              <Button primary onClick={copy}>
                {copied() ? 'Copied' : 'Copy command'}
              </Button>
            </div>
            <p class="text-xs text-muted">{props.after}</p>
          </>
        )}
      </Show>
      <Show when={problem()}>
        <p role="alert" class="mt-2 text-xs text-red-500">
          {problem()}
        </p>
      </Show>
    </div>
  );
}
