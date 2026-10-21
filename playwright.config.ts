import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage for the studio.
 *
 * The timeouts are deliberately enormous: the first run downloads roughly 30 MB of
 * WebAssembly (the interpreter plus the geospatial wheels) before anything renders.
 * Later runs hit the HTTP cache, but a cold CI run genuinely takes a while.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 240_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
