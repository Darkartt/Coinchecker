import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledLicenses } from './scripts/bundled-licenses.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  envDir: path.resolve(root, '../..'),
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: {
        panel: path.resolve(root, 'index.html'),
        'service-worker': path.resolve(root, 'src/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client'],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
  plugins: [react(), bundledLicenses()],
});
