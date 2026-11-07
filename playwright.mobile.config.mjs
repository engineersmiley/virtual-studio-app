import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/mobile',
  testMatch: '*.spec.mjs',
  outputDir: './generated-artifacts/mobile-touch',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.MOBILE_CHROMIUM_PATH
      ? { executablePath: process.env.MOBILE_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'npx vite --config tests/mobile/vite.config.mjs',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
  },
});
