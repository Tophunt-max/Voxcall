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
- **Auth**: Real API via `services/api.ts` → Cloudflare Workers
- **API Client**: `services/api.ts` with `EXPO_PUBLIC_API_URL` env var

#### Folder Structure (Route Groups)
```
app/
  _layout.tsx         ← Root layout (shared providers, Stack config)
  index.tsx           ← Splash screen + auth redirect
  +not-found.tsx
  
  (shared)/           ← Code shared between user & host (transparent URL prefix)
    auth/
      onboarding.tsx  → /auth/onboarding
      role-select.tsx → /auth/role-select
    call/             → /call/* (audio/video call screens, both use)
    chat/             → /chat/* (chat detail, both use)
    about.tsx, settings.tsx, notifications.tsx, ... (utility screens)
  
  (user)/             ← All USER-specific code (transparent URL prefix)
    auth/
      login.tsx       → /auth/login
      register.tsx    → /auth/register
      fill-profile.tsx, select-gender.tsx, forgot-password.tsx, etc.
    screens/user/     → /screens/user (user tab navigator)
    payment/          → /payment/*
    profile/          → /profile/*
    hosts/            → /hosts/* (browse & view host profiles)
  
  (host)/             ← All HOST-specific code (transparent URL prefix)
    auth/
      host-login.tsx        → /auth/host-login
      host-register.tsx     → /auth/host-register  (Step 1)
      host-profile-setup.tsx→ /auth/host-profile-setup (Step 2)
      host-become.tsx       → /auth/host-become (Step 3)
      host-kyc.tsx          → /auth/host-kyc (Step 4)
      host-status.tsx       → /auth/host-status
    screens/host/     → /screens/host (host tab navigator)
    host/             → /host/* (dashboard, settings, withdraw)
```
**Key insight**: Route groups `()` don't change URLs. `/auth/login` works the same whether the file is at `auth/login.tsx` or `(user)/auth/login.tsx`. This makes future app splitting easy — just copy `(user)/` folder to a new Expo app.

### Backend (artifacts/api-server)
- **Framework**: Hono.js on Cloudflare Workers
- **Database**: D1 (SQLite) — 13 tables (users, hosts, coin_plans, etc.)
- **Storage**: R2 bucket: `voxcall` (avatars, media)
- **Real-time**: Durable Objects (ChatRoom, CallSignaling, NotificationHub)
- **Production URL**: `https://voxlink-api.ssunilkumarmohanta3.workers.dev`
- **Account ID**: `b592b3b2a5455323a76de721a92699cd`
- **D1 Database ID**: `e591c16e-d6c0-447d-9a94-84d10aa4a705`
- **CF Calls App ID**: `536d1e7e8d540b7ccfb238d32f734d1a`
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

Tables: `users`, `hosts`, `coin_plans`, `coin_transactions`, `call_sessions`, `chat_rooms`, `messages`, `ratings`, `withdrawal_requests`, `notifications`, `faqs`, `talk_topics`, `app_settings`, `host_applications`

### host_applications table
KYC verification applications. Fields: id, user_id, display_name, date_of_birth, gender, phone, bio, specialties, languages, experience, audio_rate, video_rate, aadhar_front_url, aadhar_back_url, verification_video_url, status (pending|under_review|approved|rejected), rejection_reason, reviewed_by, reviewed_at, submitted_at

## Auth System (Session 4)

### User Auth
- `login.tsx` — Real API login (email/password) + Google button UI (coming soon) + Guest login (creates temp account via `/api/auth/guest-login`)
- `register.tsx` — Real API registration with gender field
- `AuthContext.tsx` — Now uses `StorageKeys.AUTH_TOKEN` + `StorageKeys.USER`, adds `loginWithToken(token, user)` method

### Host Multi-Step KYC Registration
1. `host-login.tsx` — Real API login; if role!=host → redirects to host-register
2. `host-register.tsx` — Step 1: Create account (email+password) → calls `/api/auth/register`
3. `host-profile-setup.tsx` — Step 2: DOB, gender, phone, display name
4. `host-become.tsx` — Step 3: Specialties, languages, bio, audio/video rates
5. `host-kyc.tsx` — Step 4: Upload Aadhar front+back photos + verification video via `/api/upload/media`
6. `host-status.tsx` — Shows application status: pending/under_review/approved/rejected with timeline and rejection reason

### API Routes Added
- `POST /api/auth/guest-login` — creates temp guest account (50 coins)
- `GET /api/host-app/status` — check own KYC application status
- `POST /api/host-app/submit` — submit/update KYC application
- `GET /api/admin/host-applications` — list all applications (filterable by status)
- `GET /api/admin/host-applications/:id` — single application detail
- `PATCH /api/admin/host-applications/:id/review` — approve or reject with reason

### Admin Panel
- New **KYC Applications** page (`HostApplications.tsx`) — list with status badges, review modal with document viewer, approve/reject with reason
- Added to sidebar nav under OVERVIEW section
- Image lightbox for Aadhar photo review
- Video preview for verification video

## New Features (Session 3)

### 1. Host Level System
- 5 levels: Newcomer 🌱, Rising ⭐, Expert 🔥, Pro 💎, Elite 👑
- `hosts` table: `level` column (1-5)
- Level badge shown on host profile screen
- Admin can manually set level or auto-recalculate based on calls+rating

### 2. Separate Audio/Video Call Rates
- `hosts` table: `audio_coins_per_minute` and `video_coins_per_minute` columns
- TalkNowSheet shows correct rate per call type
- Backend uses type-specific rate for `max_seconds` and coin deduction
- `call_sessions` table: `rate_per_minute` stores actual rate used

### 3. Chat Unlock (Call-First Policy)
- `hosts` table: `chat_unlock_policy = 'call_first'` (default for all hosts)
- Chat button shows 🔒 if user hasn't called the host yet
- Clicking locked chat shows Alert asking user to call first
- API: `GET /api/hosts/:id/chat-status` returns `{ unlocked, reason }`
- `POST /api/chat/rooms` returns 403 if chat locked
- Chat auto-unlocks after any completed call with the host

### 4. Real API Chat (No Mock Data)
- ChatContext upgraded to use real `API.getChatRooms()` and `API.getMessages()`
- `sendMessage` calls `API.sendMessage()` with optimistic UI update
- chat/[id].tsx loads messages from real API on mount

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
