/**
 * The Worker. Static assets (the app) are served by Cloudflare without running
 * this code; only `/api/*` reaches it (see `run_worker_first` in wrangler.jsonc):
 * `/api/sync/*` is the sync API, `/api/ai/*` the proxy to the Claude relay (and speech to text),
 * `/api/capture` adds items from Claude Code, `/api/pages/*` serves the pages sent with them,
 * `/api/feed` is the read-only feed for pergent, `/api/mcp` lets Claude Code search and read the notes.
 */
import { handleAi, type AiEnv } from './ai';
import { handleCapture } from './capture';
import { handleFeed, type FeedEnv } from './feed';
import { handleMcp } from './mcp';
import { handlePages } from './pages';
import { handleSync } from './sync';

interface Env extends AiEnv, FeedEnv {
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
    if (pathname === '/api/capture') {
      try {
        return await handleCapture(request, env);
      } catch (error) {
        console.error('capture failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname.startsWith('/api/pages/')) {
      try {
        return await handlePages(request, env);
      } catch (error) {
        console.error('pages failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname === '/api/feed') {
      try {
        return await handleFeed(request, env);
      } catch (error) {
        console.error('feed failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname === '/api/mcp') {
      try {
        return await handleMcp(request, env);
      } catch (error) {
        console.error('mcp failed', error);
        return Response.json({ error: 'server error' }, { status: 500 });
      }
    }
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
