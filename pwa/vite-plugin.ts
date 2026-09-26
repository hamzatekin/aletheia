import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Emits /sw.js (from pwa/sw.js) on build, with this build's files to precache
 * and a version derived from them, so each deploy gets a fresh cache.
 */
export function serviceWorker(): Plugin {
  const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
  return {
    name: 'aletheia-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name !== 'index.html' && !name.endsWith('.map'))
        .map((name) => `/${name}`)
        .sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = template
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(files.concat('/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png')));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
