import { defineConfig, devices } from '@playwright/test';

const offlineFirebaseEnvironment = {
  ...process.env,
  VITE_FIREBASE_API_KEY: '',
  VITE_FIREBASE_AUTH_DOMAIN: '',
  VITE_FIREBASE_PROJECT_ID: '',
  VITE_FIREBASE_APP_ID: '',
} as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === 'chrome' ? 'chrome' : undefined, viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === 'chrome' ? 'chrome' : undefined, viewport: { width: 390, height: 844 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: 'npm run dev:test',
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: false,
      timeout: 30_000,
      env: offlineFirebaseEnvironment,
    },
    {
      // Exercise the actual Registry as well as the isolated failure fixtures.
      command: 'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: false,
      timeout: 30_000,
      env: offlineFirebaseEnvironment,
    },
  ],
});
