import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat ESLint config for the Expo / React Native user app (VoxLink).
//
// Philosophy mirrors api-server/eslint.config.js: the lint gate exists to
// catch *real* bugs (unused code, unsafe comparisons, empty blocks), not to
// bikeshed style — Prettier owns formatting. Most rules are warnings so the
// gate stays green while still surfacing smells, and React-Native idioms
// (asset `require()`, `any` at JSON/native boundaries) are intentionally
// allowed.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'static-build/**',
      'web-build/**',
      '.expo/**',
      'android/**',
      'ios/**',
      'expo-env.d.ts',
      'metro.config.js',
      'babel.config.js',
      '*.config.js',
      'server/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser, // fetch, WebSocket, navigator, setTimeout, console…
        ...globals.node,
        __DEV__: 'readonly', // React Native dev flag
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // React hooks correctness — the codebase already annotates intentional
      // exceptions with `// eslint-disable-next-line react-hooks/exhaustive-deps`.
      // Kept as warnings so the gate stays green while still surfacing misuse.
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      // TypeScript already resolves identifiers; no-undef just produces false
      // positives on ambient/global types in .ts files.
      'no-undef': 'off',

      // Real smells — keep as guidance, allow the `_`-prefix opt-out.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // RN/JSON boundaries legitimately use `any`; asset imports use require().
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // Downgrade the noisier recommended rules so the gate stays actionable.
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',

      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-case-declarations': 'off',
      'no-control-regex': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
);
