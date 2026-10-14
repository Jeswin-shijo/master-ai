/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pageHeaders } from './src/hosting';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  // The production build is previewed (CI's browser tests) under the same headers it is hosted with.
  preview: { headers: pageHeaders(process.env.VITE_API_URL ?? 'http://localhost:3000') },
  // Browser tests (__tests__/e2e/) run in Playwright, not here.
  test: { include: ['__tests__/unit/**/*.test.ts'], environment: 'node' },
});
