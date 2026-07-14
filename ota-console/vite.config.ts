import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The OTA worker origin the console talks to. Override with OTA_WORKER_URL at
// build time. Not a secret — it's the public manifest/console host.
const apiOrigin = process.env.OTA_WORKER_URL ?? 'https://ota.ssunilkumarmohanta3.workers.dev';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  define: {
    'import.meta.env.VITE_API_ORIGIN': JSON.stringify(apiOrigin),
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '0.0.0.0', port: Number(process.env.PORT ?? 5100) },
});
