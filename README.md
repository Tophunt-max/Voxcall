<div align="center">

# 📞 VoxLink

**Production-grade voice & video calling platform with a coin-based economy.**

Two mobile apps (User + Host) on Expo · Cloudflare-native backend · Real-time WebRTC · Admin dashboard

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-4.6-FF6633)](https://hono.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

</div>

---

## 📖 Table of Contents

- [What is VoxLink?](#-what-is-voxlink)
- [Architecture at a glance](#%EF%B8%8F-architecture-at-a-glance)
- [Apps in this monorepo](#-apps-in-this-monorepo)
- [Tech Stack](#-tech-stack)
- [Features](#-features)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Environment Variables](#-environment-variables)
- [Database Migrations](#%EF%B8%8F-database-migrations)
- [Deployment](#-deployment)
- [API Surface](#-api-surface)
- [Business Rules](#-business-rules)
- [Security Model](#-security-model)
- [Production Hardening](#%EF%B8%8F-production-hardening)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 What is VoxLink?

VoxLink connects users with verified hosts for one-on-one **audio and video calls**, billed by the minute via an in-app coin economy. Think a more focused, professional alternative to talk-with-strangers apps — every host completes KYC, every minute is metered atomically, and the platform takes a transparent revenue share.

**Three roles, three apps:**

| Role | App | What they do |
|------|-----|--------------|
| 👥 **User** | `voxlink/` | Browse hosts, buy coins, place audio/video calls, chat |
| 🎙️ **Host** | `voxlink-host/` | Receive calls, manage availability, withdraw earnings |
| 🛡️ **Admin** | `admin-panel/` | KYC review, finance, content, analytics, audit logs |

All three share a single Cloudflare-native backend (`api-server/`) — Hono on Workers, D1 for storage, R2 for media, Durable Objects for real-time chat / call signaling / notifications.

---

## 🏗️ Architecture at a glance

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User App      │     │   Host App      │     │  Admin Panel    │
│  Expo + RN      │     │  Expo + RN      │     │ React + Vite    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         │     HTTPS / WSS  +  JWT Bearer auth            │
         └───────────────────────┼────────────────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │   api-server (Hono on CF)   │
                  │   - REST routes              │
                  │   - WebSocket handlers       │
                  └─────┬─────┬─────┬─────┬─────┘
                        │     │     │     │
                  ┌─────▼─┐ ┌─▼──┐ ┌▼───┐ ┌▼──────────────┐
                  │  D1   │ │ R2 │ │FCM │ │ Durable        │
                  │SQLite │ │Blob│ │HTTP│ │ Objects        │
                  └───────┘ └────┘ └────┘ │ • ChatRoom     │
                                          │ • CallSignaling│
                                          │ • NotifHub     │
                                          └────────────────┘
                                                  │
                                          ┌───────▼────────┐
                                          │ Cloudflare     │
                                          │ Calls (SFU)    │
                                          │ → WebRTC media │
                                          └────────────────┘
```

Media flows peer-to-SFU-to-peer via Cloudflare Calls; signaling rides our `CallSignaling` Durable Object; presence and call notifications use the `NotificationHub` DO with FCM as a push fallback.

---

## 📱 Apps in this monorepo

| Package | Path | Stack | Deploys to |
|---------|------|-------|------------|
| `@workspace/voxlink` | `voxlink/` | Expo 54 · React Native 0.81 · expo-router | App stores + `voxcall.pages.dev` |
| `@workspace/voxlink-host` | `voxlink-host/` | Expo 54 · React Native 0.81 · expo-router | App stores + `voxcallhost.pages.dev` |
| `@workspace/admin-panel` | `admin-panel/` | React 19 · Vite · TanStack Query · Tailwind · Radix UI | Cloudflare Pages |
| `@workspace/api-server` | `api-server/` | Hono · Cloudflare Workers · D1 · R2 · Durable Objects | Cloudflare Workers |

Plus internal libraries:

| Package | Purpose |
|---------|---------|
| `@workspace/api-spec` | OpenAPI spec — single source of truth |
| `@workspace/api-zod` | Zod validators generated from the spec |
| `@workspace/api-client-react` | TanStack Query hooks generated from the spec |
| `@workspace/db` | Drizzle ORM schema for D1 |

---

## 🛠️ Tech Stack

### Mobile (both apps)
- **Expo 54** + **React Native 0.81** + **expo-router** (file-based routing)
- **react-native-webrtc** (native) / browser WebRTC (web) over Cloudflare Calls
- **@react-native-firebase/messaging** for FCM push notifications
- **expo-av** for ringtones
- **@shopify/flash-list v2** for performant lists
- **AsyncStorage** + custom storage abstraction
- **@react-native-google-signin** for Google OAuth

### Backend
- **Hono 4** on **Cloudflare Workers** (single global edge runtime)
- **D1** (SQLite at the edge) with 22 numbered migrations
- **R2** for avatars, KYC documents, and media uploads
- **Durable Objects** for stateful real-time:
  - `ChatRoom` — per-room WS message broadcast
  - `CallSignaling` — per-session SDP/ICE relay with hibernation support
  - `NotificationHub` — per-user push hub with offline-disconnect detection
- **JWT (HS256)** via `jose` with **revocation** (`token_invalidated_at`)
- **PBKDF2-100k** password hashing with constant-time comparison
- **Zod** validation on every mutating endpoint
- **Cron Triggers** for stale-call reaping (every 5 min)
- **HMAC-verified webhooks** for Razorpay, Stripe, PhonePe, Paytm

### Admin Panel
- **React 19** + **Vite 7** + **wouter** (lightweight router)
- **TanStack Query** for server state
- **Radix UI** primitives + **Tailwind CSS 4**
- **Recharts** for analytics
- **react-hook-form** + Zod resolvers

---

## ✨ Features

### For users
- 🔐 Email + password, Google OAuth, or quick guest login (device-keyed)
- 🔍 Browse online hosts with cursor-paginated infinite scroll
- 🎲 Random matchmaking (audio or video)
- 📞 Audio + video calls with **server-synced billing timer**
- 💬 Real-time chat unlocked after first call
- 💰 Coin purchases via Razorpay / Stripe / PhonePe / Paytm / manual UPI
- 🎁 Referral program with anti-Sybil safeguards
- 🌐 Multi-language: English, Hindi, Spanish, Arabic, Chinese

### For hosts
- 📝 Multi-step KYC (Aadhaar + selfie video)
- 💵 Configurable per-minute rates (audio + video separately)
- 🟢 One-tap online/offline toggle with **auto-go-online** option
- 🔕 **Do Not Disturb** mode (suppresses all notifications)
- 📊 Live earnings dashboard
- 🏦 Payout method (Bank / UPI / Paytm / PhonePe)
- 💸 Withdrawal requests with status tracking
- 🏆 Level system (Newcomer → Bronze → Silver → Gold → Platinum → Elite)

### For admins
- 👥 User & host management with bans / suspensions
- ✅ KYC application review queue
- 📈 Daily analytics (calls, revenue, signups, retention)
- 💳 Payment gateway config + manual QR codes
- 📣 Bulk + targeted push notifications
- 🎯 Promo codes & banners
- 📜 Append-only audit log for every admin mutation
- 🚨 Content reports & moderation actions

---

## 📁 Project Structure

```
Voxcall/
├── voxlink/                      User mobile app (Expo)
│   ├── app/                      expo-router screens
│   │   ├── user/                 Authenticated user screens
│   │   ├── shared/               Auth + onboarding
│   │   └── _layout.tsx           Root providers + AppBridge
│   ├── components/               Reusable UI
│   ├── context/                  React Context (Auth, Call, Chat, Socket)
│   ├── hooks/                    useWebRTC, useCallTimer, useRingtone, etc.
│   ├── services/                 API client, FCM, WebRTC service
│   ├── localization/             i18n (en, hi, es, ar, zh)
│   └── utils/                    Storage, format helpers
│
├── voxlink-host/                 Host mobile app (Expo) — same shape as above
│   ├── app/calls/                Call screens (incoming, outgoing, audio, video)
│   ├── app/payout-method.tsx     Bank/UPI/Paytm/PhonePe picker
│   └── utils/hostSettings.ts     Centralized settings store
│
├── api-server/                   Cloudflare Workers backend (Hono)
│   ├── src/
│   │   ├── index.ts              App entry, CORS, WS routing, cron
│   │   ├── routes/               REST handlers (auth, user, host, call, chat,
│   │   │                         coin, payment, admin, public, upload, ...)
│   │   ├── middleware/           authMiddleware, adminMiddleware, auditLog
│   │   ├── lib/                  jwt, hash, fcm, cf-calls, email
│   │   └── durable-objects/      ChatRoom, CallSignaling, NotificationHub
│   ├── migrations/               D1 SQL migrations 0001–0022
│   ├── wrangler.toml             Cloudflare bindings + cron triggers
│   └── seed.sql                  Local-dev seed data
│
├── admin-panel/                  React + Vite admin dashboard
│   └── src/
│       ├── pages/                Route components
│       ├── components/           Tables, charts, dialogs
│       └── hooks/                Server-state hooks
│
├── lib/                          Shared internal packages
│   ├── api-spec/                 OpenAPI source
│   ├── api-zod/                  Generated Zod validators
│   ├── api-client-react/         Generated TanStack Query hooks
│   └── db/                       Drizzle schema for D1
│
├── .github/workflows/            CI/CD — auto-deploy on push to main
│   ├── deploy-backend.yml        api-server → Cloudflare Workers
│   ├── deploy-mobile.yml         voxlink → Pages
│   ├── deploy-host-mobile.yml    voxlink-host → Pages
│   ├── deploy-admin.yml          admin-panel → Pages
│   ├── android-eas-build.yml     User app Android build via EAS
│   └── android-eas-build-host.yml Host app Android build via EAS
│
├── pnpm-workspace.yaml           Monorepo definition + dependency catalog
└── package.json                  Workspace root
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 10 (`corepack enable`)
- **Wrangler CLI** for backend dev (`npm i -g wrangler`)
- **Expo CLI** for native builds (optional — `npx expo` works too)
- A Cloudflare account if you want to run the backend (free tier is enough)

### 1. Clone & install

```bash
git clone https://github.com/Tophunt-max/Voxcall.git
cd Voxcall
pnpm install
```

This installs all workspaces. The first run takes ~2 minutes; subsequent installs are content-addressed (instant).

### 2. Environment setup

Copy the example env files (they live next to each package) and fill in real values:

```bash
cp voxlink/.env.example       voxlink/.env
cp voxlink-host/.env.example  voxlink-host/.env
cp admin-panel/.env.example   admin-panel/.env
# api-server uses .dev.vars for Wrangler local dev:
cp api-server/.dev.vars.example api-server/.dev.vars  # if present
```

See [Environment Variables](#-environment-variables) for the full list.

### 3. Start the services you need

```bash
# Backend (Cloudflare Workers via wrangler dev — http://localhost:8787)
pnpm --filter @workspace/api-server run dev

# User mobile app (web preview on http://localhost:8080)
pnpm --filter @workspace/voxlink run dev

# Host mobile app (configure PORT to avoid collision with user app)
PORT=8099 pnpm --filter @workspace/voxlink-host run dev

# Admin panel (http://localhost:5000)
pnpm --filter @workspace/admin-panel run dev
```

Native builds: scan the QR code with the Expo Go app, or run `npx expo run:ios` / `npx expo run:android` from inside `voxlink/` or `voxlink-host/`.

### 4. Initialize the local database

```bash
cd api-server
wrangler d1 migrations apply voxlink-db --local
wrangler d1 execute voxlink-db --local --file=./seed.sql
```

The seed creates a default admin: `admin@voxlink.app` / change the password immediately.

### 5. Verify everything works

```bash
# Type-check the whole monorepo
pnpm --filter "*" run typecheck

# Build the backend (dry-run, no deploy)
pnpm --filter @workspace/api-server run build

# Build a mobile web export
pnpm --filter @workspace/voxlink run build
```

---

## 🔐 Environment Variables

### Mobile apps (`voxlink/.env`, `voxlink-host/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_API_URL` | ✅ | Backend base URL (e.g. `https://your-worker.workers.dev`) |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | ✅ | Firebase Web API key for FCM |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase auth domain |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | ✅ | Firebase project id |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | ✅ | Firebase storage bucket |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ✅ | FCM sender id |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | ✅ | Firebase app id |
| `EXPO_PUBLIC_FIREBASE_VAPID_KEY` | ✅ | Web push VAPID key |

For native builds, `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) are also required and **gitignored** — drop them in the app root.

### Backend (`api-server/.dev.vars` for local, Cloudflare secrets for production)

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | ✅ | Long random string for JWT signing |
| `CF_CALLS_APP_ID` | ✅ | Cloudflare Calls App ID |
| `CF_CALLS_APP_SECRET` | ✅ | Cloudflare Calls App Secret |
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | Firebase Admin SDK service account JSON (one line) |
| `RESEND_API_KEY` | ⚠️ | For OTP / password-reset emails |
| `MIGRATION_SECRET` | ⚠️ | Required only if using the admin `/run-migrations` endpoint |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | ⚠️ | Base64-encoded Google Play service account for in-app purchase verify |

For production, set via the Cloudflare dashboard or `wrangler secret put NAME`.

### Admin panel (`admin-panel/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | Backend base URL |

---

## 🗄️ Database Migrations

D1 migrations live in `api-server/migrations/` and are applied in numerical order.

```bash
# Local development DB
cd api-server
wrangler d1 migrations apply voxlink-db --local

# Production DB (after deploying)
wrangler d1 migrations apply voxlink-db --remote
```

**Migration index:**

| # | What it adds |
|---|--------------|
| 0001 | Initial schema (users, hosts, calls, chat, coins, withdrawals, ratings, ...) |
| 0002–0010 | favorites, google auth, device id, admin features, rate limits, error reporting, status |
| 0011–0014 | Missing tables, performance indexes, token rotation, relational specialties |
| 0015–0017 | Covering indexes, KYC indexes, call track names |
| 0018–0019 | Call status indexes, stuck-call cleanup |
| 0020 | Schema fixes (drift between run-migrations and migrations dir) |
| 0021 | Index for online/offline toggle presence broadcast |
| 0022 | Host payout method + payout details |

Adding a migration: create `00NN_description.sql`, run `wrangler d1 migrations apply --local` to test, commit, and push. Production deploys do **not** auto-apply migrations — run them manually with `--remote` or wire it into your deploy workflow.

---

## ☁️ Deployment

### Auto-deploy on push to `main`

GitHub Actions watches path filters and deploys what changed:

| Workflow | Triggers on changes to | Deploys to |
|----------|-----------------------|------------|
| `deploy-backend.yml` | `api-server/**` | Cloudflare Workers |
| `deploy-mobile.yml` | `voxlink/**` | Cloudflare Pages |
| `deploy-host-mobile.yml` | `voxlink-host/**` | Cloudflare Pages |
| `deploy-admin.yml` | `admin-panel/**` | Cloudflare Pages |
| `android-eas-build.yml` | manual / tag | EAS Android user-app build |
| `android-eas-build-host.yml` | manual / tag | EAS Android host-app build |

### Required GitHub secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | All deploy-* workflows |
| `CLOUDFLARE_ACCOUNT_ID` | All deploy-* workflows |
| `CF_CALLS_APP_SECRET` | `deploy-backend` (set as Worker secret on first deploy) |
| `JWT_SECRET` | `deploy-backend` |
| `FIREBASE_SERVICE_ACCOUNT` | `deploy-backend` |
| `EXPO_TOKEN` | `android-eas-build*` |

### Manual deploy

```bash
# Backend
cd api-server && pnpm run deploy

# Mobile web
cd voxlink && pnpm run build
# upload static-build/ to Cloudflare Pages

# Admin
cd admin-panel && pnpm run build:cloudflare
# upload dist/ to Cloudflare Pages
```

---

## 🔌 API Surface

The full API is described by `lib/api-spec/` (OpenAPI). High-level groups:

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/auth/*` | Public + JWT | Register, login, OTP, refresh, Google login, quick login |
| `/api/user/*` | JWT | User profile, become-host, account delete |
| `/api/hosts/*` | Public | Browse hosts, paginated |
| `/api/host/*` | JWT (host) | Host profile, online toggle, earnings, payout method |
| `/api/host-app/*` | JWT | KYC application status |
| `/api/calls/*` | JWT | Initiate, answer, end, rate, history, CF Calls SDP exchange |
| `/api/chat/*` | JWT | Rooms, messages, WebSocket bridge |
| `/api/coins/*` | JWT | Balance, history, plans, apply promo |
| `/api/payment/*` | JWT + webhook HMAC | Initiate, verify, webhooks |
| `/api/match/*` | JWT | Random matchmaking |
| `/api/admin/*` | JWT (admin) | Everything admin |
| `/api/upload/*` | JWT | Avatar + media uploads to R2 |
| `/api/files/:key` | Public | Public R2 download (KYC paths blocked) |
| `/api/errors` | Optional JWT | Client error reports |
| `/api/healthz` | Public | Liveness probe |
| `/api/ws/notifications` | JWT (token in query) | NotificationHub WS |
| `/api/ws/call/:sessionId` | JWT | CallSignaling WS |
| `/api/chat/ws/:roomId` | JWT | ChatRoom WS |

---

## 💼 Business Rules

| Rule | Value | Notes |
|------|-------|-------|
| Coin → USD | **1 coin = $0.01** | Configurable in `app_settings.coin_to_usd_rate` |
| Host revenue share | **70%** | Configurable in `app_settings.host_revenue_share` |
| Default audio rate | 5 coins/min | Per-host override allowed |
| Default video rate | 8 coins/min | Per-host override allowed |
| Min withdrawal | 100 coins | Configurable in `app_settings.min_withdrawal_coins` |
| New-user signup bonus | 100 coins | Awarded on OTP verification, not registration |
| Referral bonus | 25 coins (referrer) + 10 coins (referred) | After OTP verify only — anti-Sybil |
| Quick-login coins | 0 | Guest accounts get nothing — anti-Sybil |
| Call timeout (ringing) | 45 seconds | Caller and receiver both enforce |
| Stale-call reaper | 30 minutes | Cron-driven — refunds stuck coins |
| Chat unlock policy | After first completed call | Per-host configurable |
| Token lifetime | 2 days | 30-day refresh ceiling |
| Rate limits | 10/min auth · 3/10min OTP · 2/hour quick-login | Per IP |

---

## 🛡️ Security Model

VoxLink takes security seriously. Highlights:

- **JWT (HS256)** with server-side revocation via `token_invalidated_at` (logout, password reset)
- **PBKDF2-100k** password hashing with **constant-time** comparison; legacy SHA-256 hashes still verify but new ones use PBKDF2
- **Atomic coin transfer** — `UPDATE … WHERE EXISTS (… coins >= ?)` so a caller can never go negative even under contention
- **Webhook HMAC verification** — Razorpay, Stripe, PhonePe, Paytm — endpoint refuses requests without a configured secret
- **CORS allowlist** — anchored regex prevents `voxlinkattacker.com` from matching
- **WebSocket impersonation prevented** — server-derived role passed via trusted `X-CF-*` headers; DOs ignore client query params
- **KYC document protection** — `/api/files/:key` blocks paths containing `kyc`, `aadhar`, `verification`, etc.
- **Path traversal blocked** at the public file endpoint
- **CSRF mitigations** — Bearer tokens (no cookies), constrained `allowMethods` list
- **Rate limits** on auth, OTP, password reset, quick-login, and error reporting
- **PII boundaries** — server logs IDs, never bodies/headers; client logs IDs only
- **Email enumeration prevention** in `/forgot-password` (always returns 200)

For a deeper dive, see the production-readiness audit report.

---

## 🛠️ Production Hardening

This codebase has been through multiple rounds of production audit. Notable hardening:

- **Race-free call accept** — `isAcceptingRef` guard + server `started_at` sync (no billing drift on slow networks)
- **Server-synced billing timer** — `useCallTimer` initializes from server's `started_at` instead of `Date.now()` to prevent 5–15s drift during WebRTC negotiation
- **Multi-channel call-end propagation** — WebSocket + FCM push fallback + 15s WebRTC failure timer + 10s session-status poll. Single failure cannot strand either party.
- **Atomic OTP verification** — `UPDATE … WHERE is_verified = 0` so two concurrent verify-otp requests can't both award the welcome bonus
- **Stale-call cron reaper** — runs every 5 minutes; ends pending calls older than 2 min and active calls older than 30 min, with atomic guard to prevent double-charging
- **Idempotent webhook processing** — `coin_purchases.payment_ref UNIQUE` plus `WHERE status != 'success'` CAS so retries can't double-credit
- **Session lifetime cap** — refresh extends but cannot exceed 30 days from original `iat`
- **Anchored CORS regex** — added after the `voxlinkattacker.com` near-miss
- **Hibernatable Durable Objects** — `state.acceptWebSocket()` survives DO sleep cycles, and `serializeAttachment` carries `userId` across hibernation for clean disconnect detection
- **Path-filtered CI** — only the touched packages deploy; mobile builds don't trigger on backend-only PRs

---

## 🤝 Contributing

1. Fork the repo and create a feature branch from `main`
2. Make your changes and run `pnpm typecheck` to confirm everything compiles
3. Commit with a clear message — see commit conventions below
4. Push and open a pull request

### Commit conventions

We use a lightweight Conventional Commits style:

```
fix(host-app): online/offline toggle reliability
feat(api-server): add Stripe webhook handler
chore: bump expo-image to 3.0.11
docs(README): clarify migration commands
```

Common scopes: `host-app`, `user-app`, `api-server`, `admin-panel`, `db`.

### Code style

- **TypeScript everywhere** — no plain JS in app code
- **Strict null checks** — `tsc` passes for every package
- **`pnpm`** — never commit `package-lock.json` or `yarn.lock`
- **No `any` without justification** — `as any` casts should have a one-line comment explaining why
- **Hindi/English mix in user-facing strings is OK** — but use the localization files for translatable copy

### Pull request checklist

- [ ] `pnpm --filter <pkg> run typecheck` passes
- [ ] No new `console.log` in production code paths (use `console.warn`/`error`)
- [ ] No secrets / API keys / PII committed
- [ ] If touching the DB schema, a migration file is added under `api-server/migrations/`
- [ ] If touching the OpenAPI spec, regenerate the client + zod packages

---

## 📜 License

MIT — see the workspace root `package.json`. The codebase was originally bootstrapped from a Replit template (the `@replit/connectors-sdk` dependency is unused but kept for forward-compat). All app code, business logic, schema, and assets are MIT.

---

<div align="center">

**Built with ❤️ for connecting people through voice and video.**

[Report an issue](https://github.com/Tophunt-max/Voxcall/issues) ·
[Discussions](https://github.com/Tophunt-max/Voxcall/discussions)

</div>
