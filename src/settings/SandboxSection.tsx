import { inSandbox, SANDBOX_PATH } from '@/app/sandbox';
import { Button } from '@/ui/widgets';

/**
 * Settings drawer section: go to the sandbox, or back to the real notes. Each
 * has its own database, so switching is a full page load, not a navigation.
 */
export function SandboxSection({ className }: { className: string }) {
  return (
    <section data-testid="sandbox-section" className={className}>
      <h2 className="mb-2 font-semibold">Sandbox</h2>
      {inSandbox ? (
        <>
          <p className="mb-3 text-xs text-muted">You're in the sandbox. It stays in this browser, never syncs, and can't change your notes.</p>
          <Button primary onClick={() => window.location.assign('/')}>
            Back to my notes
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">A blank outline for trying things out, like AI. It stays in this browser, never syncs, and can't change your notes.</p>
          <Button onClick={() => window.location.assign(SANDBOX_PATH)}>Open sandbox</Button>
        </>
      )}
    </section>
  );
}
