# VoxLink User App (`voxlink`) — Audit & Quality Pass

> Companion to `PRODUCTION_READINESS.md` (backend) and the host-app review
> rounds. This document records a full-application analysis and the
> quality-hardening pass applied to the **user app** and the surrounding
> monorepo tooling.

**Status at audit time:** all 4 packages typecheck clean; backend suite green
(196 tests). The codebase is mature and well-audited — most historically
documented bugs are already fixed. The work below closes the remaining
*consistency* gaps rather than fixing critical defects.

---

## 1. Home feed (`app/user/screens/home/index.tsx`) — logic & robustness

- **Pull-to-refresh now refreshes every rail.** Previously `onRefresh` only
  invalidated `['hosts']`; now it invalidates all home queries in parallel
  (hosts, recommended, favorites, talk-topics, home banners, free-call
  minutes) so a pull genuinely refreshes the whole screen.
- **`PRESENCE_UPDATE` socket handler fixed.** `invalidateQueries()` was being
  called *inside* a `setQueryData` updater (updaters must be pure — React Query
  may run them more than once). The side effect was hoisted out: we read the
  cache once, then either patch the single host's online flag or invalidate on
  a cache miss. Removed the unused `hostUserId` variable.
- **Banner auto-advance consolidated.** The `setInterval` setup was duplicated
  in the mount effect *and* in `onMomentumScrollEnd`, which could leave two
  overlapping timers running. Both now call a single `restartAutoSlide()`
  helper, and an `onScrollToIndexFailed` guard avoids a rare layout-race crash.
- **Listener list rendering deduped.** The offline list was filtered twice; it
  is computed once now. The large "no listeners" empty illustration only shows
  when there are genuinely zero hosts for the filter — when offline listeners
  exist below, a compact note is shown instead (the illustration + a populated
  list beneath it was contradictory).
- Removed dead imports (`Animated`, `showErrorToast`) and the now-unused
  `refetchHosts` alias.

> Note: the app uses **React Compiler** (`babel-plugin-react-compiler`, enabled
> via `app.json`), which auto-memoizes. Manual `useMemo`/`memo` was therefore
> intentionally **not** added — it would be redundant and is discouraged here.

## 2. Accessibility

- `screens/home/messages.tsx`: the two icon-only buttons (open-search and
  clear-search) lacked labels — added `accessibilityRole="button"` and
  `accessibilityLabel`.
- The rest of the home tabs were already in good shape: `index.tsx` header
  buttons, `profile.tsx` (edit / change-photo / copy-ID / buy-coins) and
  `random.tsx` (skip / filters) already carry roles and labels.

## 3. Lint gate (monorepo-wide consistency)

Previously only `api-server` had ESLint. Added flat ESLint configs + a `lint`
script to the three remaining packages:

| Package | Config | Result |
|---|---|---|
| `voxlink` | `eslint.config.mjs` | 0 errors / 109 warnings |
| `voxlink-host` | `eslint.config.mjs` | 0 errors / 91 warnings |
| `admin-panel` | `eslint.config.js` | 0 errors / 23 warnings |
| `api-server` | (pre-existing) | 0 errors / 7 warnings |

The configs mirror `api-server`'s philosophy — **warnings, not errors**, so the
gate stays green while surfacing smells — plus React-Native-aware overrides
(`@typescript-eslint/no-require-imports` off for asset `require()`,
`no-explicit-any` off at JSON/native boundaries) and the
`eslint-plugin-react-hooks` rules (the codebase already annotates intentional
`exhaustive-deps` exceptions).

New dev dependencies (`eslint`, `@eslint/js`, `typescript-eslint`, `globals`,
`eslint-plugin-react-hooks`, and `vitest` for the user app) were added and the
lockfile regenerated. **`pnpm install --frozen-lockfile` was verified to pass**
so the deploy pipeline (which installs with `--frozen-lockfile`) is unaffected.

> Not wired into CI yet: the existing 109/91/23 warnings should be burned down
> before promoting `lint` to a blocking CI step, so a green gate isn't
> immediately demoted. The scripts let the team run `pnpm --filter <pkg> lint`
> locally today.

## 4. Logging hygiene

- `context/ChatContext.tsx`: `loadConversations` / `loadMessages` error paths
  used `console.log` — switched to `console.warn` (they're handled, non-fatal
  errors).
- `app/_layout.tsx`: the FCM foreground diagnostic log is now gated behind
  `__DEV__`.
- Operational real-time diagnostics in `SocketService` / `webrtc`
  (connect/reconnect/ICE-restart) were intentionally **kept** — for a
  real-time calling app these are useful production signals, mirroring how the
  backend treats `console.*` as its log transport.

## 5. Tests (user app)

The user app previously had **no test runner**. Added a lightweight Vitest
setup scoped to `test/**` only (`environment: 'node'`) so it never tries to
evaluate React-Native/Expo component files:

- `test/validators.test.ts` — **28 tests** covering all 12 pure validators
  (email, password, confirm-password, phone, name, OTP, bio, amount, username,
  bank account, UPI, IFSC), including boundary conditions. These guard the
  auth, profile and payout (bank/UPI/IFSC) money-critical forms.

Run with `pnpm --filter @workspace/voxlink test`.

---

## Dark mode — honest assessment (no blind sweep)

A raw grep reported ~338 hardcoded hex colors in the user app, which initially
looked like a large dark-mode gap. **Reading the code showed the metric is
misleading**, so a mechanical "replace all hex with tokens" sweep was
deliberately **not** performed — it would have broken intentional designs:

- **Already themed** screens (e.g. `screens/home/search.tsx`) use `useColors()`
  for actual rendering; their hardcoded hex are `StyleSheet` *fallbacks* that
  are overridden inline by `{ color: colors.text }` etc.
- **Intentionally custom / always-dark** screens — `screens/home/random.tsx`
  (cream-branded match experience with image backdrops) and the call screens
  (`call/audio-call.tsx`, `call/video-call.tsx`, designed dark regardless of
  scheme) — should keep their fixed palettes.
- **Self-contained** screens that hardcode *both* background and text render
  consistently (just always-light); they are not "broken/invisible" in dark
  mode.

**Recommended follow-up (needs a device/emulator, not a static sweep):** a
visual dark-mode QA pass focused on *mixed-mode* screens — those that read
`useColors()` text colors but still have an un-overridden hardcoded light
background, which is the only combination that actually produces unreadable
contrast. This requires running the app in dark mode and eyeballing each
screen; it can't be safely automated from hex counts alone.

---

## Deferred product / infrastructure decisions (need an owner's call)

These are tracked elsewhere and are **decisions**, not pending code fixes:

- **D1 → PostgreSQL migration** — plan exists in `POSTGRESQL_MIGRATION_PLAN.md`;
  trigger is scale (roughly > 5,000 DAU). No action until then.
- **Engagement roadmap Priority 5/6** (user XP/VIP tiers, collaborative-filtering
  recommendations) — see `ENGAGEMENT_ROADMAP.md`.
- **`become.tsx` specialty cap** — product decision on the max number of
  specialties a host may select.
- **Open `TODO`s** (2): a thin secure-store wrapper for `voxlink/utils/storage.ts`,
  and per-admin rate limiting follow-up in `api-server/src/middleware/auth.ts`.

---

## Verification performed

- `tsc --noEmit` — clean on all 4 packages (incl. the new user-app test files).
- `eslint .` — exit 0 on all 4 packages.
- `vitest run` — api-server 196 passing; voxlink validators 28 passing.
- `pnpm install --frozen-lockfile` — passes (deploy pipeline safe).
