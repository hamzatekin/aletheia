import { describe, expect, it } from 'vitest';
import { fetchPage } from './pages';

describe('fetchPage', () => {
  it('gets the page with the sync key', async () => {
    let seen: [string, RequestInit | undefined] | null = null;
    const page = await fetchPage('sync-key', 'abc', async (url, init) => {
      seen = [String(url), init];
      return Response.json({ title: 'Week 42', html: '<h1>Hi</h1>', createdAt: 1 });
    });
    expect(page).toEqual({ title: 'Week 42', html: '<h1>Hi</h1>' });
    expect(seen).toEqual(['/api/pages/abc', { headers: { Authorization: 'Bearer sync-key' } }]);
  });

  it('throws the server message, or the status when there is none', async () => {
    await expect(fetchPage('k', 'a', async () => Response.json({ error: 'This page does not exist.' }, { status: 404 }))).rejects.toThrow('This page does not exist.');
    await expect(fetchPage('k', 'a', async () => new Response('oops', { status: 502 }))).rejects.toThrow('Could not open the page (502).');
    await expect(fetchPage('k', 'a', async () => Response.json({ title: 't' }))).rejects.toThrow('Could not open the page (200).');
  });

  it('keeps the id inside the path and reads a missing title as empty', async () => {
    let url = '';
    const page = await fetchPage('k', '../sync/pull', async (u) => {
      url = String(u);
      return Response.json({ html: 'x' });
    });
    expect(url).toBe('/api/pages/..%2Fsync%2Fpull');
    expect(page).toEqual({ title: '', html: 'x' });
  });
});
