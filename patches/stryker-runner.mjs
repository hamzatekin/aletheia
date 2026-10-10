// Fixes @stryker-mutator/vitest-runner 10.0.0 for Vitest 5, which matches
// testNamePattern against names joined with ' > '. Unfixed, every mutant runs
// zero tests and "survives". `pnpm mutate` runs this first. It edits
// node_modules instead of using `pnpm patch` because Cloudflare's build runs an
// older pnpm that rejects a pnpm-workspace.yaml and patch hashes from pnpm 10.
import fs from 'node:fs';
import path from 'node:path';

const OLD = "return nameParts.join(' ').trim();";
const NEW = "return nameParts.map((part) => part.trim()).filter(Boolean).join(' > '); // patched for Vitest 5";

const dir = fs.realpathSync('node_modules/@stryker-mutator/vitest-runner/dist/src');
for (const name of ['stryker-setup.js', 'test-helpers.js']) {
  const file = path.join(dir, name);
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(NEW)) continue;
  if (!text.includes(OLD)) throw new Error(`${file} changed; check whether the runner still needs this fix`);
  // The file is a hard link into pnpm's shared store; replace it rather than edit it in place.
  fs.rmSync(file);
  fs.writeFileSync(file, text.replace(OLD, NEW));
}
