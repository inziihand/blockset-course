import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const identityOrigin = process.env.STRATEXEC_IDENTITY_BASE_URL ?? 'http://127.0.0.1:8180';

export default defineConfig({
  plugins: [react()],
  // Keep one environment contract at the monorepo root. Only VITE_* values
  // are exposed to browser code; server-only admin settings remain private.
  envDir: '../..',
  server: {
    proxy: {
      '/api/identity': { target: identityOrigin, changeOrigin: false },
      '/api/app-packages': { target: 'http://127.0.0.1:8182', changeOrigin: false },
      '/api/deployments': { target: 'http://127.0.0.1:8183', changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api/identity': { target: identityOrigin, changeOrigin: false },
      '/api/app-packages': { target: 'http://127.0.0.1:8182', changeOrigin: false },
      '/api/deployments': { target: 'http://127.0.0.1:8183', changeOrigin: false },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    __BUILD_REVISION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 8) ?? 'local'),
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
  },
});
