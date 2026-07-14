// ============================================================================
// Web console — a dependency-free single-page dashboard (Expo-style) served at
// /console, plus its token-gated JSON API. This barrel is the only surface the
// worker entry (index.ts) needs to import.
//
//   src/console/
//     index.ts      ← this barrel
//     auth.ts       ← bearer-token authorization
//     api.ts        ← /console/api/* request handler
//     store.ts      ← R2 read/manage functions (pure data layer)
//     page.ts       ← assembles the HTML document from assets/
//     assets/
//       shell.html  ← page markup (with __STYLES__ / __CLIENT__ placeholders)
//       styles.css  ← styling
//       client.js   ← the client-side app (vanilla JS, no deps)
// ============================================================================

export { renderConsolePage } from './page';
export { handleConsoleApi } from './api';
