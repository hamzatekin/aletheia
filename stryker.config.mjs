// Mutation testing (StrykerJS): `pnpm mutate`. Stryker makes small changes
// (mutants) to the code below and runs the unit tests against each one; a
// mutant that no test notices "survives" and points at a missing assertion.
// The scope is the pure logic, where a unit test can pin behavior down.
// The Vitest runner is patched (patches/) for Vitest 5, which matches test
// names as "suite > test"; unpatched, every mutant runs zero tests and survives.
export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'src/model/*.ts',
    'src/commands/*.ts',
    'src/search/*.ts',
    'src/io/*.ts',
    'src/sync/wire.ts',
    'src/sync/outbox.ts',
    'src/sync/clock.ts',
    'src/sync/service.ts',
    'worker/sync.ts',
    '!**/*.test.ts',
    '!src/model/index.ts',
    '!src/commands/index.ts',
    '!src/io/index.ts',
    '!src/model/seed.ts',
    '!src/io/browser.ts',
    '!src/io/types.ts',
    '!src/model/operation.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  tempDirName: '.stryker-tmp',
  // Stryker rewrites tsconfig references with the TypeScript JS API, which
  // TypeScript 7 no longer ships. The sandbox is a full copy of the project,
  // so nothing needs rewriting; an empty name skips that step.
  tsconfigFile: '',
  thresholds: { high: 90, low: 80, break: 85 },
};
