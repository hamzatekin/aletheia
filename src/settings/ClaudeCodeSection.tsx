import { useState } from 'react';
import { Button } from '@/ui/widgets';
import { createCaptureKey, setupCommand } from './claude-code';

/** Under Sync: set up a computer so Claude Code's /aletheia skill can add items here. */
export function ClaudeCodeSection({ syncKey }: { syncKey: string }) {
  const [command, setCommand] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const setUp = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const key = await createCaptureKey(syncKey);
      setCommand(setupCommand(window.location.origin, key, Intl.DateTimeFormat().resolvedOptions().timeZone));
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
    <div data-testid="claude-code" className="mt-4">
      <h3 className="mb-1 text-xs font-semibold">Claude Code</h3>
      <p className="mb-2 text-xs text-muted">Run /aletheia in Claude Code to save its answer here, under Work › today's date.</p>
      {command ? (
        <>
          <p className="mb-1.5 text-xs text-muted">Run this once in a terminal on your computer:</p>
          <textarea
            readOnly
            value={command}
            rows={4}
            aria-label="Setup command"
            onFocus={(e) => e.target.select()}
            className="mb-2 block w-full resize-none rounded border border-line bg-transparent px-2 py-1 font-mono text-xs text-muted"
          />
          <div className="mb-2 flex gap-2">
            <Button primary onClick={copy}>
              {copied ? 'Copied' : 'Copy command'}
            </Button>
          </div>
          <p className="text-xs text-muted">It saves a key that can only add items, and installs the skill. Setting up again turns this key off.</p>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void setUp()}>
          Set up Claude Code
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
