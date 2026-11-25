import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', online: 'online.html' } } },
  test: { globals: true, environment: 'node' },
} as any);
