import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin, Rollup } from 'vite';

/**
 * The files the app loads up front: the entry, what it imports, and the
 * fonts its CSS uses. Lazy chunks (KaTeX, for notes with math) and their
 * fonts are left out; the service worker caches them when first used.
 */
function upfrontFiles(bundle: Rollup.OutputBundle): string[] {
  const names = Object.keys(bundle);
  const seen = new Set<string>();
  const visit = (name: string) => {
    const file = bundle[name];
    if (seen.has(name) || !file) return;
    seen.add(name);
    if (file.type === 'chunk') {
      file.imports.forEach(visit);
      file.viteMetadata?.importedCss.forEach(visit);
      file.viteMetadata?.importedAssets.forEach(visit);
    } else if (name.endsWith('.css')) {
      const css = String(file.source);
      for (const other of names) if (css.includes(other.slice(other.lastIndexOf('/') + 1))) visit(other);
    }
  };
  for (const [name, file] of Object.entries(bundle)) if (file.type === 'chunk' && file.isEntry) visit(name);
  return [...seen];
}

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
      const files = upfrontFiles(bundle)
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
