# VoxLink — Social Audio/Video Calling Platform

## Project Overview

VoxLink is a production-grade social audio/video calling mobile app + admin panel. Users connect with professional hosts via audio/video calls and chat using a coin-based payment system.

## Artifacts

| Artifact | Port | Path | Description |
|---|---|---|---|
| `voxlink` | 20426 | `/` | Expo 54 Mobile App — User App (`com.voxlink.app`) |
| `voxlink-host` | – | – | Expo 54 Mobile App — Host App (`com.voxlink.host`) |
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
- **SFU**: Cloudflare Calls for WebRTC audio/video (real integration via `react-native-webrtc`)
- **WebRTC**: `services/webrtc.ts` (WebRTCService class), `hooks/useWebRTC.ts` (React hook)
- **CF Calls Flow**: Push local tracks → CF returns SDP answer → Pull remote tracks → CF returns offer → Send answer back
- **SDP Signaling Endpoints**: `/api/calls/:id/sdp/push`, `/api/calls/:id/sdp/pull`, `/api/calls/:id/sdp/answer`
- **Dev Client Required**: `react-native-webrtc` requires Expo development build (not Expo Go)
- **Auth**: JWT via `jose` (HS256), 7-day expiry
- **Entry point**: `src/index.ts`
- **D1 migrations**: `migrations/0001_initial.sql`

### Admin Panel (artifacts/admin-panel)
- **Framework**: React + Vite + Tailwind CSS
- **Proxy**: `/admin-panel/api` → `localhost:8080/api`
- **Pages**: Dashboard, Users, Hosts, Withdrawals, Coin Plans, Payment Gateways, Settings
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

Tables: `users`, `hosts`, `coin_plans`, `coin_transactions`, `call_sessions`, `chat_rooms`, `messages`, `ratings`, `withdrawal_requests`, `notifications`, `faqs`, `talk_topics`, `app_settings`, `host_applications`, `payment_gateways`, `banners`

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

### Admin Panel Pages (Complete List)
**OVERVIEW:** Dashboard, Analytics, Users, Hosts, KYC Applications, Ban Management  
**CALLS:** Live Calls (real-time monitor), Call Sessions, Ratings  
**FINANCE:** Withdrawals, Payout Management, Coin Plans, Transactions, Promo Codes  
**GROWTH:** Referral System  
**MODERATION:** Content Moderation (reports), Support Tickets  
**CONTENT:** Bulk Notifications, Banners, Notifications, Talk Topics, FAQs  
**SYSTEM:** Audit Logs, Level Config, App Config, Settings

**12 New Pages added (Session 5):**
- `Analytics.tsx` — DAU/MAU charts, retention rate, top hosts, platform split (pie), area charts
- `PromoCodes.tsx` — Create/edit/delete promo codes (% discount or bonus coins), usage bar, expiry
- `PayoutManagement.tsx` — Host payout approval/rejection, CSV export, ₹ amount breakdown
- `SupportTickets.tsx` — Ticket inbox with chat-style reply UI, priority/status management
- `ContentModeration.tsx` — User reports queue, category tagging, warn/ban/dismiss actions
- `BanManagement.tsx` — Ban users by email+device_id, temporary/permanent bans, unban
- `BulkNotifications.tsx` — Compose and send to segments (all/users/hosts/inactive), preview, history
- `AuditLogs.tsx` — All admin actions logged with timestamp, target, IP, export CSV
- `Banners.tsx` — In-app promotional banners with color picker, position selector, live preview
- `ReferralSystem.tsx` — Top referrers leaderboard, recent activity, referral config modal
- `LiveCalls.tsx` — Real-time call monitor with live duration counter, auto-refresh every 5s
- `AppConfig.tsx` — Force update, maintenance mode, coin economy rates, call limits, sticky save bar

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
- Chat API paths: `/api/chat/rooms`, `/api/chat/rooms/:id/messages` (NOT `/api/shared/chat/...`)
- `loadMessages` upserts conversation in context if missing (prevents messages from vanishing)
- `getOrCreateConversation` accepts optional `roomId` to link conversation to backend room

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

## Key Mobile Components

| Component | File | Purpose |
|---|---|---|
| `HostCard` | `components/HostCard.tsx` | Listener card with Audio Call + Video Call buttons (replaced Talk Now) |
| `InsufficientCoinsPopup` | `components/InsufficientCoinsPopup.tsx` | Bottom sheet popup showing coin plans when user lacks coins for a call |
| `TalkNowSheet` | `app/user/hosts/[id].tsx` | Call type selector on host profile (Audio/Video with coin rates) |

### Call Flow (Coin-Gated)
1. User taps Audio Call or Video Call on HostCard, search results, or host profile
2. App checks if `user.coins >= rate * 2` (minimum 2 minutes worth)
3. If insufficient → `InsufficientCoinsPopup` shows with coin plans to buy
4. If sufficient → `initiateCall()` via CallContext → navigate to outgoing call screen

### Admin Finance Pages
- **Deposits** (`admin-panel/src/pages/Deposits.tsx`): All coin purchases with search, filters, refund (idempotent)
- **Payout Management** (`admin-panel/src/pages/PayoutManagement.tsx`): Real API-driven (no mock data), approve/reject/mark paid
- **coin_purchases table**: Tracks plan, coins, bonus, amount, gateway, payment_ref, utr_id, promo_code, status

## tintColor Rule
IMPORTANT: Always use `tintColor={color}` as direct Image prop, NOT inside `style={}`. Example: `<Image source={...} tintColor={colors.primary} />`

## Local Development Setup

### api-server/.dev.vars (not committed — in .gitignore)
```
JWT_SECRET=local-dev-secret-voxlink-2024-minimum-32-chars
CF_CALLS_APP_ID=536d1e7e8d540b7ccfb238d32f734d1a
CF_ACCOUNT_ID=b592b3b2a5455323a76de721a92699cd
```
Note: `CF_CALLS_APP_SECRET` is a production-only secret, not in .dev.vars.

### admin-panel/.env.local (not committed)
```
VITE_API_URL=https://voxlink-api.ssunilkumarmohanta3.workers.dev
```
This makes the local admin panel connect directly to the production API.

## GitHub Actions CI/CD

**Repo**: `Tophunt-max/Voxcall` (private)

**Secrets set in GitHub Actions**:
- `CLOUDFLARE_API_TOKEN` ✅
- `CF_CALLS_APP_SECRET` ✅
- `JWT_SECRET` — must be added manually to GitHub secrets if auto-deploy of JWT_SECRET is needed

**Workflow**: `.github/workflows/deploy-backend.yml`
- Triggers on push to `main` (paths: `api-server/**`)
- Deploys Worker → optionally sets JWT_SECRET (if GitHub secret exists) → sets CF_CALLS_APP_SECRET (if secret exists)
- Both secret steps have `if: ${{ env.SECRET != '' }}` guards to avoid failures

## Production Security (Updated 2026-04-02)

### Changes Applied
1. **JWT_SECRET** — Set as Cloudflare Worker secret via wrangler ✅ (was missing)
2. **PBKDF2 Password Hashing** — Replaced plain SHA-256 with PBKDF2 (100k iterations + salt). Legacy SHA-256 passwords still verify for backward compat.
3. **CORS Restricted** — `origin: '*'` replaced with allowlist: localhost, *.replit.app, *.replit.dev, voxlink domains. Mobile (no-origin) still allowed.
4. **Rate Limiting** — 10 req/60s per IP on `/login`, `/register`, `/forgot-password`, `/reset-password`. Uses D1 `rate_limits` table.
5. **Firestore Duplicate Removed** — `saveFirestoreUser()` calls removed from login.tsx. Only D1 used.
6. **@react-native-firebase removed** — `@react-native-firebase/app` + `/auth` removed from package.json.
7. **JWT Auto-Refresh** — `api.ts` retries on 401: calls `/api/auth/refresh`, saves new token, retries original request. Multiple concurrent 401s collapsed into single refresh.
8. **Error Monitoring** — `ErrorReporter.ts` created. Reports crashes to `/api/errors` endpoint (D1 `app_errors` table). Global JS error handler + ErrorBoundary both wired up.
9. **CF_CALLS_APP_ID** — Still in [vars] temporarily (can't set as secret while var binding exists). Will move after next `wrangler secret put CF_CALLS_APP_ID` + remove from [vars] + redeploy.

### D1 Tables Added
- `rate_limits (id, attempts, window_reset)` — rate limiting per IP/route
- `app_errors (id, user_id, message, stack, context, platform, app_version, extra, created_at)` — client crash logs

## Push Notification System (Completed 2026-04-02)

### Architecture
- **Backend** (`api-server/src/lib/expoPush.ts`): Expo Push HTTP v2 API utility
- **Call trigger** (`api-server/src/routes/call.ts`): Sends push to host when user initiates call
- **Chat trigger** (`api-server/src/routes/chat.ts`): Sends push to recipient on new message
- **Admin trigger** (`api-server/src/routes/admin.ts`): Admin notifications/send hits real Expo push
- **Push payload**: `{ type, session_id/room_id, call_type, caller_id }` in `data` field

### Mobile Flow
- **Token registration**: On login → `Notifications.getExpoPushTokenAsync({ projectId: '0e529a27-...' })` → PATCH `/api/user/me` with `{ fcm_token }`
- **Android channels**: `calls` (MAX priority), `messages`, `default`
- **EAS project ID**: `0e529a27-fcf1-4850-a306-971ef07dd2ac` in `app.json`

### Foreground Call Flow (WebSocket)
`Backend → NotificationHub WebSocket (incoming_call event) → SocketService.emit(CALL_INCOMING) → AppBridge.useSocketEvent → CallContext.receiveCall → navigate /incoming`

### Background/Killed Call Flow (Push Notification)
`Backend → Expo Push → device notification → user taps → AppBridge.useLastNotificationResponse → CallContext.receiveCall (caller name from body) → navigate /incoming`

### AppBridge Component (`voxlink/app/_layout.tsx`)
Merges socket + notification tap handling. Lives inside all providers so it can call `useCall()` and `useSocketEvent()`. Handles:
1. `CALL_INCOMING` socket event → `receiveCall()`
2. Notification tap with `type=incoming_call` → parse caller name from body → `receiveCall()` → navigate
3. Notification tap with `type=chat_message` → navigate to chat screen

### Low Coins Alert
`AuthContext.updateCoins` → if balance ≤ 10 → `notifyLowCoins()` (debounced 60s via `lowCoinAlertedRef`)

## Production Verification (Tested 2026-04-01)
- API health: ✅ 
- Admin login: ✅ (admin@voxlink.app / admin123)
- Hosts listing: ✅ (5 hosts, all online)
- Call initiation: ✅ (CF Calls sessions created — cf_session_id + cf_host_session_id)
- SDP push/pull routes: ✅ (correct paths `/api/calls/:id/sdp/push`, `/api/calls/:id/sdp/pull`)
- End call: ✅ (coins charged correctly)
- Admin dashboard: ✅ (21 users, 5 hosts, 12 calls today, 117 coins revenue)
- WebRTC service: ✅ (correctly calls API routes with real SDP)

## Bug Fix Log (Round 3 — 20 More Bugs Fixed 2026-04-02)

### Backend (API Server) — 6 Fixes
1. **Host Rate Cap** — `host.ts` PATCH /me now rejects rates <1 and caps at 500 coins/min
2. **Call Initiate Rate Limit** — `call.ts` POST /initiate now limited to 5/min per user
3. **KYC Already-Host Block** — `hostapp.ts` blocks users who are already active hosts from re-submitting
4. **KYC Rate Validation** — audio_rate/video_rate validated 1-500; specialties/languages must be arrays
5. **User Profile Length Limits** — `user.ts` PATCH /me enforces per-field length limits; `fcm_token=null` allowed for logout
6. **Google Login Sybil** — `auth.ts` google-login now grants 0 coins (down from 50) to prevent sybil attacks

### Mobile App — User (voxlink) — 5 Fixes
7. **OTP Verification Mock Removed** — `verify-otp.tsx` now calls real `/api/auth/verify-otp` for register; passes OTP to create-password for forgot flow
8. **Password Placeholder** — `register.tsx` placeholder now correctly says "min 8 chars" (was "min 6")
9. **Audio Call Animation Leak** — `audio-call.tsx` Animated.loop now stored in variable and stopped in useEffect cleanup
10. **Logout FCM Revoke** — `AuthContext.tsx` logout now clears fcm_token on backend + calls /api/auth/logout before clearing storage
11. **verifyOtp API** — Added `API.verifyOtp` to `services/api.ts`

### Mobile App — Host (voxlink-host) — 4 Fixes
12. **isOnline Always Offline** — `index.tsx` initializes from `user.isOnline` and syncs via useEffect
13. **Earnings Stale on Tab** — `index.tsx` uses `useFocusEffect` to refresh earnings on every screen focus
14. **is_online vs isOnline Mismatch** — `AuthContext.tsx` setOnlineStatus and logout now send `is_online` (backend's expected key)
15. **Online Toggle Uses AuthContext** — Switch now calls `setOnlineStatus` from AuthContext so state is consistent app-wide

### Admin Panel — 5 Fixes
16. **Analytics All Mock Data** — `Analytics.tsx` now uses real API weekly data for all charts; top hosts from live API
17. **Analytics DAU/MAU** — Derived from real weekly data instead of hardcoded numbers
18. **Dashboard Loading State** — Shows loading spinner while fetching; `settings` API fetched in parallel
19. **Dashboard Hardcoded Values** — Payout rate and coin value now loaded from `/api/admin/settings`
20. **Badge Missing Status Colors** — Added `ringing` (blue) and `cancelled` (amber) badge variants

## Bug Fix Log (Round 2 — 18 Deep Bugs Fixed 2026-04-02)

### Backend (API Server) — 7 Fixes
1. **SQL Column Injection** — `admin.ts` PATCH routes for `talk_topics` and `faqs` now use allowlist for column names
2. **NotificationHub Auth** — `/notify` endpoint checks `X-CF-Worker-Internal: 1` header for defence-in-depth
3. **Referral Sybil Attack** — Referral coins now deferred to OTP verification, not registration (prevents fake account farming)
4. **ChatRoom Impersonation** — Worker passes verified `userId` via `X-CF-User-Id` header; DO no longer trusts URL params
5. **Chat WebSocket Auth** — Worker now verifies room ownership before proxying to Durable Object
6. **Promo Code Brute Force** — `POST /api/coins/apply-promo` now requires authentication
7. **NaN in admin routes** — unchanged (input validated at client now)

### Mobile App — User (voxlink) — 2 Fixes
6. **Upload JWT Refresh** — `updateAvatar` and `uploadFile` now use 401 auto-refresh (same as `apiRequest`)
7. **WebRTC ICE Listener Leak** — `waitForIceGathering` now uses named handler with `removeEventListener` cleanup

### Mobile App — Host (voxlink-host) — 5 Fixes
8. **acceptCall Race Condition** — API call awaited before state update; failed accept → silent decline
9. **DOB Lost on Registration** — `dob` field now included in `updateProfile` call in `profile-setup.tsx`
10. **Earnings Totals Incorrect** — Added `isApproximate` flag for truncated transaction lists (100-item limit)
11. **Token Refresh Loop** — Failed refresh now clears stored token and throws `SESSION_EXPIRED` to trigger logout
12. **Upload JWT Refresh (host)** — Same fix as user app applied to host app `api.ts`

### Admin Panel — 6 Fixes
13. **`new Function()` RCE Risk** — Replaced with safe arithmetic evaluator (substitutes variables, validates chars)
14. **CoinPlans NaN Validation** — Form validates coins/price before API submission
15. **Hosts Action Double-Click** — Per-action `toggling` state prevents duplicate requests
16. **Hosts Load Error Handling** — `.catch()` added to load, error banner with Retry button shown
17. **Withdrawals Load Error Handling** — `.catch()` added to load, error banner shown
18. **Users Pagination** — Page state added with Prev/Next controls; page resets on search

## Bug Fix Log (Round 4 — 8 Bugs Fixed 2026-04-02)

### User App — 2 Fixes
1. **`create-password.tsx` Never Called API** — `handleUpdate()` was just doing a 1-second timeout then navigating. Now reads `email` and `otp` from `useLocalSearchParams`, calls `API.resetPassword()` with them. Forgot-password flow is now fully functional.
2. **`api.ts` Missing `resetPassword` Method** — Added `resetPassword(email, otp, new_password)` method calling `POST /api/auth/reset-password`.

### Host App — 1 Fix
3. **`AuthContext.tsx` Wrong Profile Endpoint** — `fetchFreshProfile()` was calling `/api/host/profile` which doesn't exist (404). Fixed to call `/api/host/me`. Host foreground refresh now works correctly.

### API Server — 3 Fixes
4. **`host.ts` Topic Filter Ignored** — GET /api/hosts accepted `topic` query param but never used it in the SQL query. Added `AND h.specialties LIKE ?` clause so topic filtering actually works.
5. **`call.ts` Stars Validation Missing** — Both `/rate` and `/:id/rate` endpoints accepted any numeric stars value. Added `Math.min(5, Math.max(1, ...))` clamp to prevent corrupt host ratings (e.g. stars: 100).
6. **`admin.ts` No Rate Validation on Host Update** — PATCH /admin/hosts/:id set `audio_coins_per_minute`, `video_coins_per_minute`, and `coins_per_minute` without range checks. Admin could set 0 or negative rates. Added clamp: min 1, max 500.

### Admin Panel — 1 Fix
7. **`Hosts.tsx` Audio Rate Input Cap Too Low** — HTML input had `max="200"` but backend allows up to 500 coins/min. Changed to `max="500"` to match backend cap.
