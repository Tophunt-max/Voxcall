# Firebase Setup — Voxcall

Firebase is used in two places:

1. **Web Google Sign-In** (user + host web apps) — `firebase/auth` `signInWithPopup`.
2. **Push notifications (FCM)** — web (service worker) + native.

Firebase project: **`connectme-80909`**.

> **Key idea:** the Firebase **web config** (apiKey, authDomain, projectId, appId,
> messagingSenderId) is **public** — it ships in every client bundle and is *not* a
> secret. The only real secret is the **service account JSON** (server-side).

---

## 1. Where each value lives

| Value | Type | Where it goes | Used for |
|---|---|---|---|
| `EXPO_PUBLIC_FIREBASE_*` (apiKey, etc.) | Public, **build-time** | GitHub Actions **Variables** (also hardcoded as fallback in `lib/shared-ui/src/services/firebase.ts`) | Web Google sign-in, web FCM |
| `firebase-messaging-sw.js` config | Public | Hardcoded in `voxlink/public/firebase-messaging-sw.js` | Web background push |
| `FIREBASE_SERVICE_ACCOUNT` (JSON w/ private_key) | **SECRET** | **Cloudflare Worker secret** (api-server) | Verify ID tokens + send FCM push |
| `google-services.json` | Native config | Android build (EAS) | Native Google sign-in + FCM |

### Build-time vs runtime (important)
The web app is a **static export** (`expo export`) built in **GitHub Actions**, then
uploaded to Cloudflare Pages via `wrangler pages deploy`. So `EXPO_PUBLIC_*` must be
present **during the GitHub Actions build** — set them in **GitHub → Settings →
Secrets and variables → Actions → Variables**. Setting them as Cloudflare Pages/Worker
runtime vars does **not** work for the static site (the value is inlined at build time).

The **backend** (`api-server`) is a Cloudflare Worker, so its secret
(`FIREBASE_SERVICE_ACCOUNT`) **does** go in Cloudflare (wrangler secret).


---

## 2. Firebase Console checklist (required for Google Sign-In)

In [Firebase Console](https://console.firebase.google.com/) → project `connectme-80909`:

- [ ] **Authentication → Sign-in method → Google**: enabled.
- [ ] **Authentication → Settings → Authorized domains**: add the production domains
      and remove anything you don't own:
  - `voxcall.pages.dev` (user web app)
  - `voxcallhost.pages.dev` (host web app)
  - `localhost` (kept by default, fine for dev)
  - > Missing this is the #1 cause of `auth/unauthorized-domain` on web.

## 3. Google Cloud Console — API key hardening (recommended for prod)

The web apiKey is public, but you should still **restrict** it so nobody abuses your
quota. [Google Cloud Console](https://console.cloud.google.com/) → project
`connectme-80909` → **APIs & Services → Credentials → (the Browser/Web API key)**:

- [ ] **Application restrictions → HTTP referrers**: add
      `https://voxcall.pages.dev/*` and `https://voxcallhost.pages.dev/*`.
- [ ] **API restrictions → Restrict key** to only:
  - Identity Toolkit API
  - Token Service API
  - Firebase Cloud Messaging API
- [ ] (Optional) Enable **Firebase App Check** for the web app to block non-genuine clients.

## 4. Backend secret — token verification + push (Cloudflare Worker)

The api-server Worker needs the **service account JSON** to verify Firebase ID tokens
and send FCM push. This is a **real secret** — never commit it.

```bash
# From a Firebase service-account JSON (Project settings → Service accounts → Generate key)
cd api-server
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
# paste the full JSON when prompted
```

- [ ] `FIREBASE_SERVICE_ACCOUNT` set as a Worker secret (NOT in the repo / not a GitHub var).
- [ ] If unset: Google login still works for Google-OIDC tokens (verified via Google's
      tokeninfo), but Firebase-issued ID tokens and outbound FCM push will not work.


## 5. Push notifications (FCM)

- [ ] **Web**: `EXPO_PUBLIC_FIREBASE_VAPID_KEY` is set in the deploy workflow env
      (Cloud Messaging → Web Push certificates → key pair). The service worker
      (`voxlink/public/firebase-messaging-sw.js`) is configured with the web config.
- [ ] **Backend**: `FIREBASE_SERVICE_ACCOUNT` (see §4) — required to send pushes.

## 6. Native (Android) — only for the store builds

- [ ] `google-services.json` present for the EAS build.
- [ ] The build's **SHA-1** registered against the Web client ID in Google Cloud
      (Credentials → OAuth 2.0 Client IDs), else native Google sign-in returns no idToken.

---

## 7. Troubleshooting (web)

| Symptom | Cause | Fix |
|---|---|---|
| "Google sign-in isn't set up… use Quick Login" | `auth` is null — web config missing at build | Config is now hardcoded as fallback; rebuild. Ensure `lib/shared-ui` change is deployed. |
| `auth/unauthorized-domain` | Domain not in Authorized domains | Add `voxcall.pages.dev` (§2) |
| `auth/invalid-api-key` / `api-key-not-valid` | apiKey wrong/empty | Verify the value in `firebase.ts` / GitHub var matches Firebase console |
| Popup opens then "sign-in failed" | Backend can't verify the token | Set `FIREBASE_SERVICE_ACCOUNT` Worker secret (§4) |
| Popup blocked | Browser blocked popup | Allow popups for the site |
| Web push not received in background | SW Firebase config / VAPID | SW is configured (§5); confirm VAPID key + notification permission |

---

## 8. Current state (in code)

- `lib/shared-ui/src/services/firebase.ts` — web config hardcoded as fallback
  (`process.env.EXPO_PUBLIC_FIREBASE_* || "<connectme-80909 value>"`), so Google
  sign-in works even if the env vars aren't set. Env vars still take precedence.
- `voxlink/public/firebase-messaging-sw.js` — web config filled in for background push.
- `voxlink/app/user/auth/login.tsx` — clear, mapped error messages for the common
  Firebase auth failures.

> The only remaining steps are **console-side** (§2 authorized domains is the must-do,
> §3 hardening is recommended, §4 backend secret for full token verification + push).
