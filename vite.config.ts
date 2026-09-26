/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { serviceWorker } from './pwa/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  // Sync API: run `pnpm build && npx wrangler dev` alongside `pnpm dev`.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
