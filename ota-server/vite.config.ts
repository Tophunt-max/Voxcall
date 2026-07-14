import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Builds the React console UI (web/) into ./web-dist, which the Worker serves
// as static assets (see wrangler.toml [assets]). One worker, one deploy.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'web') },
    dedupe: ['react', 'react-dom'],
  },
  publicDir: false,
  build: { outDir: 'web-dist', emptyOutDir: true },
  server: { host: '0.0.0.0', port: Number(process.env.PORT ?? 5100) },
});
