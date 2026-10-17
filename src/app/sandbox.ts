import { AletheiaDB } from '@/persistence/db';
import { META_KEY } from '@/sync/service';

/**
 * The sandbox: a second outline at /sandbox, blank on first open, kept in its
 * own IndexedDB database. It never syncs, so nothing done there (AI
 * experiments included) can reach the real notes on any device.
 */
export const SANDBOX_PATH = '/sandbox';

/** Whether a URL path is inside the sandbox (`/sandbox`, `/sandbox/n/:id`, ...). */
export function isSandboxPath(pathname: string): boolean {
  return pathname === SANDBOX_PATH || pathname.startsWith(SANDBOX_PATH + '/');
}

/** Whether this page load is the sandbox. Switching between the two is a full page load. */
export const inSandbox = typeof window !== 'undefined' && isSandboxPath(window.location.pathname);

/** What the top of the outline is called: breadcrumbs, sidebar, import messages. */
export const HOME_LABEL = inSandbox ? 'Sandbox' : 'Home';

/** The sandbox's own database, apart from the real notes' `aletheia`. */
export function sandboxDb(): AletheiaDB {
  return new AletheiaDB('aletheia-sandbox');
}

/**
 * The real outline's sync key, read from its database. The sandbox doesn't sync
 * but borrows the key for AI, which the Worker only answers for a sync key.
 */
export async function mainSyncKey(): Promise<string | null> {
  const db = new AletheiaDB();
  try {
    const row = await db.meta.get(META_KEY);
    return typeof row?.value === 'string' ? row.value : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
