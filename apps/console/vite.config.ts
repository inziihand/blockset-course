import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { siteSettingsDevPlugin } from './server/siteSettingsDev';

const environmentRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode, command }) => {
  const environment = {
    ...loadEnv(mode, environmentRoot, ''),
    ...process.env,
  };
  const identityOrigin = environment.STRATEXEC_IDENTITY_BASE_URL ?? 'http://127.0.0.1:8180';
  const packageAgentOrigin = environment.STRATEXEC_APP_PACKAGE_AGENT_BASE_URL
    ?? `http://127.0.0.1:${environment.STRATEXEC_APP_PACKAGE_AGENT_PORT ?? '8182'}`;
  const deploymentAgentOrigin = environment.STRATEXEC_DEPLOYMENT_AGENT_BASE_URL
    ?? `http://127.0.0.1:${environment.STRATEXEC_DEPLOYMENT_AGENT_PORT ?? '8183'}`;

  return ({
  plugins: [
    react(),
    ...(command === 'serve' && mode === 'development'
      ? [siteSettingsDevPlugin(environmentRoot, identityOrigin)] : []),
  ],
  // Keep one environment contract at the monorepo root. Only VITE_* values
  // are exposed to browser code; server-only admin settings remain private.
  envDir: '../..',
  server: {
    proxy: {
      '/api/identity': { target: identityOrigin, changeOrigin: false },
      '/api/app-packages': { target: packageAgentOrigin, changeOrigin: false },
      '/api/deployments': { target: deploymentAgentOrigin, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api/identity': { target: identityOrigin, changeOrigin: false },
      '/api/app-packages': { target: packageAgentOrigin, changeOrigin: false },
      '/api/deployments': { target: deploymentAgentOrigin, changeOrigin: false },
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
});
