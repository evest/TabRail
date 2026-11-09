import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Extension build: service worker + sidebar page -> dist/ (load unpacked).
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: false,
    rollupOptions: {
      input: {
        background: 'src/background/index.ts',
        sidebar: 'sidebar.html',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
