import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  // GitHub Pages serves a project site under /<repo>/; the deploy workflow sets
  // BASE_PATH so built asset URLs resolve. Local dev/build default to '/'.
  base: process.env.BASE_PATH || '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@editor': resolve(__dirname, 'editor'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sandbox: resolve(__dirname, 'sandbox.html'),
      },
    },
  },
});
