import { useState } from 'react';
import { Button } from '@/ui/widgets';
import { createKey, mcpCommand, setupCommand } from './claude-code';

/**
 * Under Sync: set up a computer for Claude Code. The /aletheia skill adds
 * items here; the MCP connection lets it search and read the notes.
 */
export function ClaudeCodeSection({ syncKey }: { syncKey: string }) {
  return (
    <div data-testid="claude-code" className="mt-4">
      <h3 className="mb-1 text-xs font-semibold">Claude Code</h3>
      <KeyCommand
        intro="Run /aletheia in Claude Code to save its answer here, under Work › today's date."
        button="Set up Claude Code"
        label="Setup command"
        after="It saves a key that can only add items, and installs the skill. Setting up again turns this key off."
        make={async () => setupCommand(window.location.origin, await createKey(syncKey, 'capture'), Intl.DateTimeFormat().resolvedOptions().timeZone)}
      />
      <KeyCommand
        intro="Let Claude Code search and read your notes, so you can ask about them in the terminal."
        button="Connect to your notes"
        label="Connect command"
        after="It gives Claude Code a key that can only read, for all your projects (Passwords and Budget stay out). Connecting again turns this key off."
        make={async () => mcpCommand(window.location.origin, await createKey(syncKey, 'read'))}
        testId="claude-code-mcp"
      />
    </div>
  );
}

/** A button that makes a key and shows the command to run with it, ready to copy. */
function KeyCommand({ intro, button, label, after, make, testId }: { intro: string; button: string; label: string; after: string; make(): Promise<string>; testId?: string }) {
  const [command, setCommand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setCommand(await make());
    } catch (error) {
      setProblem(error instanceof TypeError ? 'Could not reach the sync server. Are you online?' : (error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this command', command!);
    }
  };

  return (
    <div className="mb-3" data-testid={testId}>
      <p className="mb-2 text-xs text-muted">{intro}</p>
      {command ? (
        <>
          <p className="mb-1.5 text-xs text-muted">Run this once in a terminal on your computer:</p>
          <textarea
            readOnly
            value={command}
            rows={4}
            aria-label={label}
            onFocus={(e) => e.target.select()}
            className="mb-2 block w-full resize-none rounded border border-line bg-transparent px-2 py-1 font-mono text-xs text-muted"
          />
          <div className="mb-2 flex gap-2">
            <Button primary onClick={copy}>
              {copied ? 'Copied' : 'Copy command'}
            </Button>
          </div>
          <p className="text-xs text-muted">{after}</p>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void setUp()}>
          {button}
        </Button>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {problem}
        </p>
      )}
    </div>
  );
}
