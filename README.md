# VoxLink — Voice & Video Calling Platform

A production-grade social audio/video calling platform where users connect with professional hosts through a coin-based economy.

---

## Apps

| App | Stack | Description |
|---|---|---|
| **Admin Panel** | React + Vite + Tailwind | Manage users, hosts, KYC, finance & content |
| **Mobile App** | Expo (React Native) | User & host audio/video calling app |
| **Backend API** | Hono.js + Cloudflare Workers | REST API + WebSockets + Durable Objects |

---

## Architecture

```
VoxLink/
├── admin-panel/         ← React Admin Dashboard
├── api-server/          ← Cloudflare Workers Backend
├── voxlink/             ← Expo Mobile App
├── lib/
│   ├── db/              ← Drizzle ORM Schema (D1/SQLite)
│   ├── api-spec/        ← OpenAPI Specification
│   ├── api-client-react/← Generated React Query Hooks
│   └── api-zod/         ← Generated Zod Validators
└── .github/workflows/   ← CI/CD (GitHub Actions)
```

---

## Tech Stack

**Mobile App**
- Expo 54 · React Native · expo-router
- WebRTC (Cloudflare Calls SFU)
- AsyncStorage · Poppins font

**Backend**
- Hono.js on Cloudflare Workers
- D1 (SQLite) · R2 (Storage)
- Durable Objects (real-time chat, calls, notifications)
- JWT Auth (jose) · Zod validation

**Admin Panel**
- React + Vite · Tailwind CSS
- Recharts · TanStack Query
- Radix UI components

---

## Features

### For Users
- Browse & connect with professional hosts
- Audio & Video calls (coin-gated, per-minute billing)
- Real-time chat (unlocked after first call)
- Coin purchase with multiple payment gateways
- Multi-language support (EN, HI, ZH, AR, ES)

### For Hosts
- Multi-step KYC onboarding
- Set audio/video call rates
- Real-time earnings dashboard
- Withdrawal management
- Level system (Newcomer → Elite)

### Admin Panel
- KYC application review & approval
- Live call monitoring
- Finance: deposits, payouts, coin plans
- Content: banners, FAQs, talk topics
- Analytics, audit logs, promo codes
- Push notifications (bulk/targeted)

---

## Deployment

| Service | Platform | URL |
|---|---|---|
| Backend API | Cloudflare Workers | `voxlink-api.ssunilkumarmohanta3.workers.dev` |
| Admin Panel | Cloudflare Pages | `voxlink-admin.pages.dev` |
| Mobile Web | Cloudflare Pages | `voxlink-mobile.pages.dev` |

### GitHub Actions (Auto-Deploy on push to `main`)

| Workflow | Trigger | Target |
|---|---|---|
| `deploy-backend.yml` | `artifacts/api-server/**` | Cloudflare Workers |
| `deploy-admin.yml` | `artifacts/admin-panel/**` | Cloudflare Pages |
| `deploy-mobile.yml` | `artifacts/voxlink/**` | Cloudflare Pages |

---

## Local Development

**Requirements:** Node.js 20+, pnpm 10+

```bash
# Install all dependencies
pnpm install

# Admin Panel (http://localhost:20130/admin-panel/)
PORT=20130 BASE_PATH=/admin-panel/ pnpm --filter @workspace/admin-panel run dev

# Mobile App
PORT=20426 pnpm --filter @workspace/voxlink run dev

# Backend API (Wrangler local)
pnpm --filter @workspace/api-server run dev
```

Copy example env files for local dev:
```bash
cp artifacts/admin-panel/.env.example  artifacts/admin-panel/.env
cp artifacts/voxlink/.env.example      artifacts/voxlink/.env
cp artifacts/api-server/.dev.vars.example  artifacts/api-server/.dev.vars
```

---

## Business Rules

- **1 coin = $0.01 USD**
- **Host revenue share: 70%**
- **Minimum withdrawal: 100 coins**
- **Chat unlock policy:** User must complete at least 1 call with a host first
- **Default admin:** `admin@voxlink.app` / `admin123`
