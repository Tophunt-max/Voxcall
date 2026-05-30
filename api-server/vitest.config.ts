import { defineConfig } from 'vitest/config';

// Tests run in the `forks` pool so we can pass Node flags to the worker
// processes. The integration tests use Node 22's built-in `node:sqlite`
// module (loaded via process.getBuiltinModule in test/helpers/d1.ts), which
// is still behind the `--experimental-sqlite` flag.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--experimental-sqlite', '--disable-warning=ExperimentalWarning'],
      },
    },
  },
});
