import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'pages.spec.ts',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:4174/relay-agent-os/',
    channel: process.env.CI ? undefined : 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --mode pages --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/relay-agent-os/',
    reuseExistingServer: false,
  },
});
