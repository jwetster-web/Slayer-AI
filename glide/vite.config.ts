import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    target: 'chrome130',
  },
  server: { port: 5173, strictPort: true, fs: { allow: [resolve(root)] } },
});
