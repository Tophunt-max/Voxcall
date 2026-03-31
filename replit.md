# VoxLink - Social Audio/Video Calling Platform

## Project Overview

VoxLink is a React Native Expo mobile app (iOS/Android/Web) — a marketplace where users connect with professional hosts/listeners via audio/video calls and chat, with a coin-based payment system. The UI is designed to be 80% similar to the original TalkIn/ConnectMe Flutter app.

## Architecture

- **Frontend**: React Native Expo (Expo 54, expo-router 6)
- **Backend**: None (AsyncStorage for persistence)
- **Auth**: Mock auth via `services/AuthService.ts` (planned: Firebase Auth)
- **Payments**: Full checkout flow via `services/PaymentService.ts` + `app/payment/checkout.tsx`
- **Real-time**: Mock WebSocket via `services/SocketService.ts` + `context/SocketContext.tsx`
- **Localization**: 5 languages (EN/HI/ZH/AR/ES) via `localization/` + `context/LanguageContext.tsx`
- **Font**: Poppins (via @expo-google-fonts/poppins)

## New Infrastructure (Session 3)

### Utils (`utils/`)
- `formatters.ts` — date, time, duration, coin, currency formatters
- `validators.ts` — form validation (email, password, phone, OTP, amount, UPI/IFSC)
- `storage.ts` — typed AsyncStorage wrapper with prefix, append, update helpers
- `haptics.ts` — haptic feedback (light/medium/heavy/success/error/warning)
- `permissions.ts` — camera/mic/notification permissions with alert flow

### Services (`services/`)
- `AuthService.ts` — login, register, OTP, password reset, token refresh
- `CallService.ts` — call lifecycle: initiate, accept, reject, end, rate
- `ChatService.ts` — send/receive messages, conversations, mock replies
- `PaymentService.ts` — coin purchase, spend, bonus, withdrawal + transaction history
- `NotificationService.ts` — local push notifications + in-app notification store
- `SocketService.ts` — mock WebSocket with full event emit/subscribe system

### Constants (`constants/`)
- `routes.ts` — all route paths as typed constants
- `events.ts` — all socket event names as typed constants

### Localization (`localization/`)
- `en.ts` — English strings (auth, nav, home, hosts, calls, chat, wallet, payment, host, errors)
- `hi.ts` — Hindi strings (complete)
- `zh.ts` — Chinese Simplified strings (complete)
- `ar.ts` — Arabic strings (complete, RTL-aware)
- `es.ts` — Spanish strings (complete)
- `index.ts` — i18n loader with typed `t()` helper

### Contexts (`context/`)
- `SocketContext.tsx` — connects socket on login, provides `onEvent()` + simulation helpers
- `LanguageContext.tsx` — language switching with RTL support + AsyncStorage persistence

### New Components (`components/`)
- `Avatar.tsx` — reusable avatar: 6 sizes, status ring (online/busy/offline)
- `EmptyState.tsx` — empty list placeholder with image, text, optional CTA
- `LoadingOverlay.tsx` — full-screen or inline loading spinner
- `Toast.tsx` — slide-in toast notifications with auto-dismiss (success/error/warning/info)
- `Skeleton.tsx` — shimmer loading placeholders (+ HostCardSkeleton, MessageSkeleton, ProfileSkeleton)
- `BottomSheet.tsx` — slide-up sheet with backdrop + `ActionSheet` variant

### New Screens (`app/payment/`)
- `checkout.tsx` — full payment checkout: package grid, payment method, order summary
- `success.tsx` — animated payment success screen with balance display

## Artifact: voxlink

- **Path**: `artifacts/voxlink/`
- **Preview path**: `/`
- **Port**: `$PORT` (20426)

## App Structure

```text
artifacts/voxlink/
├── app/
│   ├── _layout.tsx           # Root layout with all providers (Auth, Call, Chat) + Poppins fonts
│   ├── index.tsx             # Entry redirect (logged in → tabs, else → onboarding)
│   ├── auth/
│   │   ├── onboarding.tsx        # 3-slide onboarding
│   │   ├── login.tsx             # Email/password + guest login; links to forgot-password
│   │   ├── register.tsx          # Registration form
│   │   ├── forgot-password.tsx   # Forgot password → sends OTP
│   │   ├── verify-otp.tsx        # 6-digit OTP input with countdown resend
│   │   ├── create-password.tsx   # Set new password after OTP verify
│   │   ├── fill-profile.tsx      # Post-register profile: name, bio, languages
│   │   └── select-gender.tsx     # Gender card selection screen
│   ├── (tabs)/                   # User mode tab navigation (5 tabs — matches Flutter)
│   │   ├── _layout.tsx           # Tab bar: Home, Listener, Random, Chat, Calling (acc purple active #A00EE7)
│   │   ├── index.tsx             # Home: header, Find More banner → random, Top Listeners, Browse by Topic
│   │   ├── search.tsx            # Listener tab: Language/TalkAbout filter buttons, listener cards with Talk Now
│   │   ├── random.tsx            # Random Call tab: ripple animation, listener cards cycling, audio/video modal
│   │   ├── messages.tsx          # Chat tab: light purple header (#F3E4FF), search icon, conversation list
│   │   ├── wallet.tsx            # Calling History tab: All/Audio/Video filter underline tabs, call records
│   │   └── profile.tsx           # Profile: dotted avatar, My Wallet → checkout, Edit, Settings, etc.
│   ├── (host-tabs)/              # Host mode tab navigation (4 tabs — matches Flutter)
│   │   ├── _layout.tsx           # Host tab bar: Home, Chat, Calls, Profile (accent purple #A00EE7 active)
│   │   ├── index.tsx             # Host home: online toggle, stats, dashboard quick-access
│   │   ├── chat.tsx              # Host chat list (conversations from users)
│   │   ├── notifications.tsx     # Host Calls tab: call history with All/Audio/Video filter + coins earned
│   │   ├── wallet.tsx            # Host wallet (hidden from tab bar via href: null)
│   │   └── profile.tsx           # Host profile + switch to user mode
│   ├── hosts/
│   │   ├── [id].tsx              # Host detail: reviews section, outgoing call nav
│   │   ├── all.tsx               # All hosts list
│   │   └── reviews.tsx           # All reviews for a host with rating bars
│   ├── chat/[id].tsx             # Chat screen with inverted FlatList
│   ├── call/
│   │   ├── audio-call.tsx        # Audio call UI
│   │   ├── video-call.tsx        # Video call UI
│   │   ├── incoming.tsx          # Incoming call
│   │   ├── outgoing.tsx          # Outgoing/connecting call with ripple animation
│   │   └── summary.tsx           # Post-call summary + rating
│   ├── settings.tsx              # Settings (notifications, language, sign out, delete)
│   ├── help-center.tsx           # Help Center with expandable FAQ items
│   ├── language.tsx              # App language selection list
│   ├── become-host.tsx           # Become a host (benefits + requirements + apply)
│   ├── become-host-success.tsx   # Host application sent confirmation
│   ├── notifications.tsx         # Notification center
│   ├── profile/edit.tsx          # Edit profile screen
│   └── host/dashboard.tsx        # Host earnings/status dashboard
├── components/
│   ├── HostCard.tsx          # Original TalkIn card: white card + shadow, square avatar, status badge, Talk Now button
│   ├── CoinBalance.tsx       # Coin balance pill with star_coin.png
│   ├── StarRating.tsx        # Interactive/display star rating
│   ├── PrimaryButton.tsx     # Branded button with haptics
│   ├── SearchBar.tsx         # Search input
│   ├── GradientHeader.tsx    # Page header component
│   └── NotificationBadge.tsx # Unread count badge
├── context/
│   ├── AuthContext.tsx       # User auth + profile state
│   ├── CallContext.tsx       # Active call state + controls
│   └── ChatContext.tsx       # Conversations + messages
├── data/mockData.ts          # 8 mock hosts, coin plans, call history, notifications
├── constants/colors.ts       # TalkIn original colors (primary #757396, bg #FAFEFF, accent #A00EE7, dark #111329)
├── hooks/useColors.ts        # Color scheme hook (auto dark mode)
└── assets/                   # All 150 original Flutter app assets extracted
    ├── icons/                # PNG icons (home_filled, random_call, chat, wallet_icon, profile_icon, etc.)
    ├── images/               # App images (onBoarding1-3, wallet_bg, star_coin_big, splash, etc.)
    ├── lottie/               # Lottie animations (bouncing_ball_loader, random_match)
    └── audio/                # Ringtone audio files
```

## Key Features

- Dual user/host roles
- 8 host profiles with specialties, languages, ratings
- Audio + video call flows with timer and controls
- Real-time chat (AsyncStorage)
- Coin wallet with purchase plans and call history
- Call history and ratings
- Notifications center with empty state images
- Host dashboard with online/offline toggle
- Random Match screen for spontaneous connections
- Dark mode support

## Color Theme (Original TalkIn Flutter App)

- Primary: `#757396` (muted grey-purple)
- Background: `#FAFEFF` (near white)
- Accent: `#A00EE7` (vibrant purple)
- App dark: `#111329` (dark navy)
- Orange/Coin: `#FFA100` (coin gold)
- Green/Online: `#0BAF23`
- Accent light: `#F3E6FF` (light purple)
- Dark mode: auto via `useColorScheme()`

## UI Design Notes (80% match to original TalkIn)

- **Font**: Poppins (400, 500, 600, 700 weights) via @expo-google-fonts/poppins
- **HostCard**: White card with box shadow (blurRadius 18), square avatar (borderRadius 8), status badge pill (green/orange/offline), language icon, topic chips, "Talk Now" button, call type icons
- **Home AppBar**: Dotted-border circular profile pic, username, unique ID badge (`#F0E4F8` bg), coin balance with star_coin.png
- **Bottom Tabs**: 5 tabs with original PNG icons (home_filled, random_call, chat, wallet_icon, profile_icon), active color primary
- **Wallet**: wallet_bg.png gradient background card, star_coin_big.png, wallet.png illustration
- **Onboarding**: 3 slides using original onBoarding1.png, onBoarding2.png, onBoarding3.png + on_boarding_arrow.png
- **Profile**: Dotted-border avatar, unique ID badge (copyable), coin icon in stats

---

# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
