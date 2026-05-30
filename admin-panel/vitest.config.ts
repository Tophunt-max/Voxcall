import { defineConfig } from 'vitest/config';

// Standalone Vitest config (intentionally NOT importing the app's vite.config,
// which pulls in Replit-only dev plugins). The current tests cover pure
// formatting/money helpers and run in a plain Node environment.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
