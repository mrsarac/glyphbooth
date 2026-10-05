import { defineConfig } from 'vite';

// base './' keeps every asset path relative, so the same build works from GitHub Pages
// (a sub-path) and from Electron (file://).
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
});
