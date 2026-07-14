// ============================================================================
// Web console API — the token-gated JSON endpoints under /console/api/*.
// The console UI itself is a React app (../../web) built by Vite and served by
// the worker as static assets; only the API lives here now.
//
//   src/console/
//     index.ts   ← this barrel
//     auth.ts    ← bearer-token authorization
//     api.ts     ← /console/api/* request handler
//     store.ts   ← R2 read/manage data layer
// ============================================================================

export { handleConsoleApi } from './api';
export { handleEasWebhook } from './webhook';
