import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// The project has no @types/node; this is the only Node API the config uses.
declare const process: { allowedNodeEnvironmentFlags: ReadonlySet<string> };

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    // The service worker is only generated for real builds, never under Vitest.
    mode !== 'test' &&
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/*.png'],
        manifest: {
          name: 'PIKLMatch',
          short_name: 'PIKLMatch',
          description: 'Pickleball matchmaking for open play sessions.',
          theme_color: '#c8f03c',
          background_color: '#fafaf7',
          display: 'standalone',
          orientation: 'any',
          id: './',
          start_url: './',
          scope: './',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: { globPatterns: ['**/*.{js,css,html,png,svg}'] },
      }),
  ],
  test: {
    exclude: ['tests/release/**', '**/node_modules/**', '**/dist/**'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // CSS is left out, except app.css, which one test reads as text to check rules that jsdom cannot compute.
    css: { include: [/app\.css/] },
    // Newer Node versions ship their own localStorage global that gets in the way of jsdom's. Switch it off where the flag exists.
    poolOptions: {
      forks: {
        execArgv: process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
          ? ['--no-experimental-webstorage']
          : [],
      },
    },
  },
}));
