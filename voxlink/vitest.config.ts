import { defineConfig } from 'vitest/config';

// Vitest config for the VoxLink user app.
//
// Scope is intentionally limited to `test/**` so the runner only picks up
// pure-logic unit tests (validators, formatters) and never tries to evaluate
// React Native / Expo component files, which require the native runtime and
// would fail under a plain Node environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
