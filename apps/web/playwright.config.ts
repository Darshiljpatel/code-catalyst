import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 90000, workers: 1,
  use: { baseURL: process.env.BROWSER_BASE_URL || 'http://localhost:5178', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list'], ['json', { outputFile: '../../verification/evidence/browser-results.json' }]],
});
