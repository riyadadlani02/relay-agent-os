import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:4311',
    channel: process.env.CI ? undefined : 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4311/api/health',
    reuseExistingServer: false,
    env: { PORT: '4311', HOST: '127.0.0.1', DATABASE_PATH: ':memory:', MODEL_API_KEY: '' },
  },
});
