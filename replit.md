# VoxLink — Social Audio/Video Calling Platform

## Project Overview

VoxLink is a production-grade social audio/video calling mobile app + admin panel. Users connect with professional hosts via audio/video calls and chat using a coin-based payment system.

## Artifacts

| Artifact | Port | Path | Description |
|---|---|---|---|
| `voxlink` | 20426 | `/` | Expo 54 Mobile App (React Native) |
| `api-server` | 8080 | – | Cloudflare Workers backend |
| `admin-panel` | 20130 | `/admin-panel/` | React + Vite Admin Panel |
| `mockup-sandbox` | 8081 | `/__mockup` | UI Component Preview Server |

## Architecture

### Mobile App (artifacts/voxlink)
- **Framework**: React Native Expo 54, expo-router 6
- **Font**: Poppins (via @expo-google-fonts/poppins)
- **Colors**: primary `#757396`, accent `#A00EE7`, bg `#FAFEFF`, coinGold `#FFA100`, online `#0BAF23`
- **Navigation**: Two tab groups — `app/screens/user/` (users) and `app/screens/host/` (hosts)
- **Auth**: Real API via `services/AuthService.ts` → `services/api.ts` → Cloudflare Workers
- **API Client**: `services/api.ts` with `EXPO_PUBLIC_API_URL` env var (default: localhost:8080)

### Backend (artifacts/api-server)
- **Framework**: Hono.js on Cloudflare Workers
- **Database**: D1 (SQLite) — 13 tables (users, hosts, coin_plans, etc.)
- **Storage**: R2 (avatars, media)
- **Real-time**: Durable Objects (ChatRoom, CallSignaling, NotificationHub)
- **SFU**: Cloudflare Calls for WebRTC audio/video
- **Auth**: JWT via `jose` (HS256), 7-day expiry
- **Entry point**: `src/index.ts`
- **D1 migrations**: `migrations/0001_initial.sql`

### Admin Panel (artifacts/admin-panel)
- **Framework**: React + Vite + Tailwind CSS
- **Proxy**: `/admin-panel/api` → `localhost:8080/api`
- **Pages**: Dashboard, Users, Hosts, Withdrawals, Coin Plans, Settings
- **Auth**: JWT token stored in localStorage, admin role required

## API Routes

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/user/me` | Get current user profile |
| PATCH | `/api/user/me` | Update profile |
| GET | `/api/hosts` | List hosts (filter: search, topic, online) |
| GET | `/api/hosts/:id` | Host details |
| PATCH | `/api/host/me` | Update host profile |
| PATCH | `/api/host/status` | Toggle online/offline |
| GET | `/api/coins/plans` | Coin purchase plans |
| POST | `/api/coins/purchase` | Buy coins |
| POST | `/api/calls/initiate` | Start a call |
| POST | `/api/calls/end` | End a call |
| GET | `/api/chat/rooms` | List chat rooms |
| GET | `/api/chat/ws/:roomId` | WebSocket chat |
| GET | `/api/admin/*` | Admin endpoints (admin role required) |
| POST | `/api/upload/avatar` | Upload avatar to R2 |

## Real-time (WebSocket)

| WebSocket Path | Durable Object | Purpose |
|---|---|---|
| `/api/chat/ws/:roomId` | ChatRoom | Real-time chat |
| `/api/ws/call/:sessionId` | CallSignaling | WebRTC signaling |
| `/api/ws/notifications` | NotificationHub | Push notifications |

## D1 Database Schema

Tables: `users`, `hosts`, `coin_plans`, `coin_transactions`, `call_sessions`, `chat_rooms`, `messages`, `ratings`, `withdrawal_requests`, `notifications`, `faqs`, `talk_topics`, `app_settings`

### Key Business Rules
- 1 coin = $0.01 USD
- Host revenue share: 70%
- Min withdrawal: 100 coins
- Default admin: admin@voxlink.app / admin123

## Mobile App Structure

### Services (services/)
- `api.ts` — Real API client, all endpoints, handles auth headers
- `AuthService.ts` — Login/register via real API
- `CallService.ts` — Call lifecycle management
- `ChatService.ts` — Chat messages
- `PaymentService.ts` — Coin purchase, spend, withdrawal
- `NotificationService.ts` — Local + in-app notifications
- `SocketService.ts` — WebSocket event system

### Utils (utils/)
- `formatters.ts` — date, time, duration, coin, currency formatters
- `validators.ts` — form validation
- `storage.ts` — typed AsyncStorage wrapper
- `haptics.ts` — haptic feedback
- `permissions.ts` — camera/mic/notification permissions

### Localization (localization/)
- 5 languages: EN, HI, ZH, AR, ES
- RTL support for Arabic
- `context/LanguageContext.tsx` with AsyncStorage persistence

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | VoxLink app | API server URL (default: http://localhost:8080) |
| `JWT_SECRET` | Wrangler (vars) | JWT signing secret |
| `CF_CALLS_APP_ID` | Wrangler (vars) | Cloudflare Calls App ID |
| `CF_CALLS_APP_SECRET` | Wrangler (vars) | Cloudflare Calls App Secret |
| `CF_ACCOUNT_ID` | Wrangler (vars) | Cloudflare Account ID |

## Deployment

- **Mobile**: Expo EAS Build → App Store / Play Store
- **Backend**: `wrangler deploy` → Cloudflare Workers + D1 + R2 + Durable Objects
- **Admin Panel**: `pnpm --filter @workspace/admin-panel build` → Static files (Cloudflare Pages or any CDN)

## tintColor Rule
IMPORTANT: Always use `tintColor={color}` as direct Image prop, NOT inside `style={}`. Example: `<Image source={...} tintColor={colors.primary} />`
