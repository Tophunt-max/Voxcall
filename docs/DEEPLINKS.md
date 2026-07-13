# Referral Deep Links & Universal / App Links

Referral invite links carry the code as a query param:

- **User app:**  `https://voxlink.app/?ref=CODE`
- **Host app:**  `https://voxlink.app/host?ref=CODE`

## What already works (no extra setup)

- **Web:** opening either link on the web build reads `?ref=` on the login/register
  screen and pre-fills the referral code. Works today.
- **In-app:** both apps listen for incoming links (`expo-linking`) on cold start
  (`getInitialURL`) and warm start (`url` event) and store the code, so a tapped
  link — custom scheme (`voxlink://…?ref=` / `voxlinkhost://…?ref=`) or a verified
  universal/App link — pre-fills the code before signup.
- The code survives the web Google-OAuth full-page redirect (persisted to storage).

## To make the `https://voxlink.app` links open the native apps

This requires two association files hosted on **voxlink.app** plus signing
credentials that must be filled in (they are not in the repo).

### 1. iOS — Apple App Site Association (AASA)

- File: [`voxlink/public/.well-known/apple-app-site-association`](../voxlink/public/.well-known/apple-app-site-association)
  (served at `https://voxlink.app/.well-known/apple-app-site-association`, no extension, `Content-Type: application/json`).
- Replace `TEAMID` with your Apple Developer **Team ID** (Apple Developer →
  Membership). Both apps share the same domain; the file routes `/host*` to the
  Host app and everything else to the User app.
- `app.json` already declares `associatedDomains: ["applinks:voxlink.app"]` for
  both apps.

### 2. Android — Digital Asset Links

- File: [`voxlink/public/.well-known/assetlinks.json`](../voxlink/public/.well-known/assetlinks.json)
  (served at `https://voxlink.app/.well-known/assetlinks.json`).
- Replace the `REPLACE_WITH_*_RELEASE_SHA256` placeholders with each app's
  **release signing** SHA-256 fingerprint:
  - EAS builds: `eas credentials` → Android → the SHA-256 of the keystore, or
    Play Console → Setup → App integrity → App signing key certificate.
- `app.json` already declares the `intentFilters` (autoVerify) — User app on
  `voxlink.app/`, Host app on `voxlink.app/host`.

### 3. Hosting note

- The `.well-known` files must be served by **whatever domain backs
  `voxlink.app`**. They are checked into the **user** web app's `public/`
  (the most likely origin for the root domain). If `voxlink.app` is served by a
  different project, copy the two files there.
- The SPA `_redirects` (`/* /index.html 200`) does not swallow them: Cloudflare
  Pages serves existing static assets before applying the rewrite, and
  `_headers` pins their `Content-Type`.

### Caveat: both apps installed on one device (Android)

Android App Links don't route by path across two apps sharing one domain, so if a
user has BOTH apps installed, a `/host` link may show an app chooser. This is an
edge case (most referred users install one app) and does not affect the web or
custom-scheme flows.

## Deferred deep linking (install-from-store)

A plain `https` link does **not** carry the `?ref=` code through a fresh Play
Store / App Store install. For that, add a deferred-deep-link provider (Branch,
Firebase Dynamic Links, or Play Install Referrer) later. Until then, the raw code
in the share message is the fallback (the friend types it once).


## Finalization checklist (do this before the store release)

Until the two placeholders below are replaced with real signing credentials, an
`https://voxlink.app` tap falls back to the browser (web `?ref=` still works) —
it will NOT open the installed native app. Nothing crashes; the feature is just
inert. Complete these steps to activate universal / App Links:

1. **Fill the credentials** (the only manual edits — everything else is wired):
   - `apple-app-site-association` → replace both `TEAMID` tokens with your Apple
     Developer **Team ID** (Apple Developer → Membership → Team ID).
   - `assetlinks.json` → replace `REPLACE_WITH_USER_APP_RELEASE_SHA256` and
     `REPLACE_WITH_HOST_APP_RELEASE_SHA256` with each app's **release** signing
     SHA-256 (`eas credentials` → Android, or Play Console → App integrity → App
     signing key certificate). Use the *App signing* key, not the upload key, if
     Play App Signing is enabled.

2. **Deploy** the user web app so the files are live on `voxlink.app`, then
   **verify they are served correctly** (both must return HTTP 200 as JSON):
   ```bash
   # AASA — must be application/json and have NO file extension
   curl -sI https://voxlink.app/.well-known/apple-app-site-association | grep -i content-type
   curl -s  https://voxlink.app/.well-known/apple-app-site-association | head -c 200
   # Android Digital Asset Links
   curl -s  https://voxlink.app/.well-known/assetlinks.json | head -c 200
   ```
   Then confirm with the official validators:
   - Apple CDN cache (what devices actually fetch):
     `https://app-site-association.cdn-apple.com/a/v1/voxlink.app`
   - Google statement list API:
     `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://voxlink.app&relation=delegate_permission/common.handle_all_urls`

3. **Device test** (release/TestFlight/internal-track build, NOT Expo Go — custom
   dev clients don't carry the entitlements):
   - iOS: tap `https://voxlink.app/?ref=TEST10` in Notes/Messages → app opens on
     the signup screen with `TEST10` pre-filled. `/host?ref=` opens the Host app.
   - Android: same, and `adb shell pm get-app-links com.voxlink.app` should show
     `voxlink.app: verified`.

4. **Re-verify after any signing-key change** (new keystore, key rotation, or a
   second Play signing key) — the SHA-256 in `assetlinks.json` must list every
   active release fingerprint or Android verification silently fails.
