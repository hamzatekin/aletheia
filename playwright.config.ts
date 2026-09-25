import { defineConfig } from '@playwright/test';

const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 900, height: 700 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // Tests use the dev-only `window.__aletheia` hook, so they run against the dev server.
  webServer: {
    command: 'pnpm dev --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
