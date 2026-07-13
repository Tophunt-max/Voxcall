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
