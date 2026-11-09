import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// UI-only build for Phase B (WebView2 virtual host mapping) and for running against
// the mock transport in a normal browser tab. Relative asset paths, no manifest, no SW.
export default defineConfig({
  plugins: [preact()],
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    rollupOptions: { input: { sidebar: 'sidebar.html' } },
  },
  server: { open: '/sidebar.html' },
});
