import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Flat ESLint config for the Cloudflare Worker API.
//
// Philosophy: the lint gate exists to catch *real* bugs (unused code, unsafe
// comparisons, fallthroughs), not to bikeshed style — Prettier owns formatting.
// `console` is intentionally allowed: in a Worker, `console.*` IS the logging
// transport (it streams to Workers Logs / `wrangler tail`).
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker, // Worker runtime: fetch, Request, Response, crypto, caches…
        ...globals.node, // process, Buffer, console, setTimeout…
        ...globals.es2022,
      },
    },
    rules: {
      // TypeScript already resolves identifiers; no-undef just produces false
      // positives on ambient/global types in .ts files.
      'no-undef': 'off',

      // The codebase intentionally uses `any` at D1/JSON boundaries. Surface it
      // as guidance, not a hard failure.
      '@typescript-eslint/no-explicit-any': 'off',

      // Unused vars are a real smell — warn, and allow the `_`-prefix opt-out.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],

      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
);
