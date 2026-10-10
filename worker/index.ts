/**
 * The Worker. Static assets (the app) are served by Cloudflare without running
 * this code; only `/api/*` reaches it (see `run_worker_first` in wrangler.jsonc):
 * `/api/sync/*` is the sync API, `/api/ai/*` the proxy to the Claude relay.
 */
import { handleAi, type AiEnv } from './ai';
import { handleSync } from './sync';

interface Env extends AiEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/sync/')) {
      try {
        return await handleSync(request, env);
      } catch (error) {
        console.error('sync failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname.startsWith('/api/ai/')) {
      try {
        return await handleAi(request, env);
      } catch (error) {
        console.error('ai failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
