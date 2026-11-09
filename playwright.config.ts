import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/release',
  use: { baseURL: 'http://127.0.0.1:4174', channel: 'chrome' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
});
