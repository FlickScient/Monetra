import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, '..'),
    },
  },
  publicDir: path.resolve(root, '../public'),
  build: {
    outDir: path.resolve(root, '../native/www'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
});
