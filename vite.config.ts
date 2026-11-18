import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA built to dist/, served by the Cloudflare Worker (worker/index.js).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
