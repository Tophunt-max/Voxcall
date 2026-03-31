# VoxLink - Social Audio/Video Calling Platform

## Project Overview

VoxLink is a React Native Expo mobile app (iOS/Android/Web) — a marketplace where users connect with professional hosts/listeners via audio/video calls and chat, with a coin-based payment system. The UI is designed to be 80% similar to the original TalkIn/ConnectMe Flutter app.

## Architecture

- **Frontend**: React Native Expo (Expo 54, expo-router 6)
- **Backend**: None (first build, AsyncStorage for persistence)
- **Auth**: Mock auth (planned: Firebase Auth)
- **Payments**: Coin system with AsyncStorage (planned: RevenueCat)
- **Font**: Poppins (via @expo-google-fonts/poppins)

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
│   │   ├── onboarding.tsx    # 3-slide onboarding with original onBoarding1/2/3.png images
│   │   ├── login.tsx         # Email/password + guest login with app_logo.png
│   │   └── register.tsx      # Registration with gender selection
│   ├── (tabs)/
│   │   ├── _layout.tsx       # Tab bar with original PNG icons (Home, Random, Chat, History, Profile)
│   │   ├── index.tsx         # Home screen with dotted-border avatar, ID badge, Find More, Top Listeners
│   │   ├── search.tsx        # Random Match screen with match animation
│   │   ├── messages.tsx      # Chat list with no_chat_list.png empty state
│   │   ├── wallet.tsx        # Wallet with wallet_bg.png, star_coin_big.png, buy coins + history
│   │   └── profile.tsx       # Profile with dotted-border avatar, ID badge, copy ID
│   ├── hosts/
│   │   ├── [id].tsx          # Host detail page (call + chat CTAs)
│   │   └── all.tsx           # All hosts list
│   ├── chat/[id].tsx         # Chat screen with inverted FlatList
│   ├── call/
│   │   ├── audio-call.tsx    # Audio call UI with controls
│   │   ├── video-call.tsx    # Video call UI with camera preview
│   │   ├── incoming.tsx      # Incoming call accept/decline
│   │   └── summary.tsx       # Post-call summary + rating
│   ├── notifications.tsx     # Notification center with no_notification_found.png
│   ├── profile/edit.tsx      # Edit profile screen
│   └── host/dashboard.tsx    # Host earnings/status dashboard
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
