# VoxCall Self-Hosted OTA (Expo Updates)

A self-hosted **over-the-air update** server for the two Expo apps — a Cloudflare
Worker that implements the [Expo Updates v1 protocol](https://docs.expo.dev/technical-specs/expo-updates-1/)
and serves JS/asset bundles straight out of the **existing R2 bucket** (`voxcall`).

**Why self-hosted:** no per-MAU billing (EAS Update charges by monthly active
users), everything stays on infrastructure you already run (Workers + R2), and
you keep full control of the update pipeline.

One deployment serves both apps:

| App | Package | Manifest URL |
|-----|---------|--------------|
| User | `voxlink` | `https://<worker>/manifest/user` |
| Host | `voxlink-host` | `https://<worker>/manifest/host` |

> **OTA updates JS + assets only.** Any **native** change (new native module,
> Expo SDK bump, permissions, `app.json` native config, icon/splash) needs a new
> **store build**. `runtimeVersion` enforces this: a build only accepts updates
> published under its own runtime version, so an old native build can never pull
> incompatible JS. Both apps use the **`fingerprint`** policy (see
> [Runtime version strategy](#runtime-version-strategy)).

---

## R2 layout (all under the `ota/` prefix)

```
ota/updates/<app>/<updateId>/update.json               ← precomputed manifest record
ota/updates/<app>/<updateId>/_expo/static/js/…         ← the JS/Hermes bundle
ota/updates/<app>/<updateId>/assets/<hash>             ← images, fonts, etc.
ota/channels/<app>/<channel>/<runtimeVersion>.json     ← { updateId } pointer (what's live)
```

Under the `fingerprint` policy iOS and Android can resolve to different runtime
versions, so a single publish writes **one pointer per platform fingerprint**,
all pointing at the same `updateId`.

The publish script (`ota-server/publish.mjs`) precomputes every hash/key, uploads
the files, and flips the channel pointer **last** — so a client never sees a
half-uploaded update.

---

## One-time setup

### 1. Deploy the Worker

```bash
cd ota-server
# auth: `wrangler login`, or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
pnpm run deploy
```

Note the deployed URL, e.g. `https://voxcall-ota.<your-subdomain>.workers.dev`.
Check it: `curl https://voxcall-ota.<your-subdomain>.workers.dev/health`.

### 2. Point the apps at it

In **`voxlink/app.json`** and **`voxlink-host/app.json`**, replace
`YOUR-SUBDOMAIN` in the `updates.url` with your real Worker subdomain
(the `updates` + `runtimeVersion` blocks are already added).

### 3. Install `expo-updates` in each app

```bash
cd voxlink       && npx expo install expo-updates
cd voxlink-host  && npx expo install expo-updates
```

### 4. Rebuild + submit ONCE to the stores

`expo-updates` is a native module, so the update config only takes effect after
a fresh native build that embeds it:

```bash
cd voxlink && eas build --platform all --profile production   # then eas submit
```

From this build onward, the app checks your OTA server on launch.

---

## Publishing an update

After making JS-only changes (screens, logic, styles, strings, images):

```bash
# User app
node ota-server/publish.mjs --app user
# Host app  (add --force for a mandatory update, --message "notes")
node ota-server/publish.mjs --app host

# or:
pnpm --filter @workspace/ota-server run publish-update -- --app user
```

The script runs `expo export`, hashes + uploads everything to R2, resolves the
`runtimeVersion` from `app.json` **per platform** (see below), and makes the
update live on the `production` channel. Installed apps pick it up on their next
launch (downloaded in the background; applied on the following restart because
`fallbackToCacheTimeout: 0`).

Options:
- `--channel preview` — publish to a separate channel (see below).
- `--runtime-version 1.2.0` — override the policy with an explicit value (both platforms).
- `--force` — mark the update **mandatory** (client shows a blocking updater and reloads immediately).
- `--message "notes"` — release notes (stored in `manifest.extra.message`; defaults to the git subject).

---

## Runtime version strategy

`runtimeVersion` is the native/JS compatibility key: a build only runs an update
whose `runtimeVersion` matches its own. Both apps set it in `app.json`:

```jsonc
"runtimeVersion": { "policy": "fingerprint" }
```

- **`fingerprint` (active).** `@expo/fingerprint` hashes the native layer
  (dependencies, native code, config) into a runtime version. `publish.mjs`
  resolves it per platform via `npx expo-updates fingerprint:generate --platform
  <ios|android>` and stores it at `platforms.<p>.runtimeVersion`; the Worker
  serves that per-platform value in the manifest. Change anything native and the
  fingerprint changes automatically, so a stale update can never reach an
  incompatible build — no manual version bump needed.
- **`appVersion` (fallback).** Ties the runtime version to `expo.version`. Simpler
  and requires no fingerprint tooling, but you must bump `expo.version` on every
  native change yourself. To use it, set `"runtimeVersion": { "policy": "appVersion" }`.
  `publish.mjs` honors whichever policy `app.json` declares.

> The fingerprint is computed from a fully-installed app project; run `publish.mjs`
> where `pnpm install` has been run for the app (locally or in CI).

---

## Web console

Two equivalent consoles read the same `ota/` R2 objects and let an operator view
update history + live channel pointers, **promote / roll back** a channel to any
update, and **toggle the mandatory flag** — no CLI needed. Publishing new bundles
still runs from the CLI/CI (it needs `expo export`).

**1. Built into this worker — `https://<your-worker>/console`.** A self-contained
Expo-style dashboard (no separate deploy, no build step) gated by a bearer token:

- **Overview** — stat cards (updates, channels, runtime versions, mandatory) plus
  a "live now" grid and recent updates.
- **Updates** — searchable history; click any row for a detail slide-over showing
  full metadata, per-platform launch bundle + asset list with download links, and
  actions (promote/rollback per channel, toggle mandatory, copy IDs/URLs).
- **Channels** — each channel's runtime-version pointers + a picker to set any
  update live (roll forward or back).

Enable it by setting the secret:

```bash
wrangler secret put CONSOLE_PASSWORD    # (in ota-server/)
# local dev: put CONSOLE_PASSWORD=... in ota-server/.dev.vars
```

While `CONSOLE_PASSWORD` is unset the console's endpoints return `503` — so the
worker never ships an open control surface. The page prompts for the password
and keeps it in `sessionStorage`; every request sends `Authorization: Bearer …`.
Console views: **Overview** (stats + live-now), **Updates** (searchable history +
detail slide-over), **Channels** (promote/rollback), and **Downloads** (below).

Endpoints: `GET /console/api/state?app=`, `GET /console/api/update?app=&id=`,
`POST /console/api/promote`, `POST /console/api/force`,
`GET|POST|DELETE /console/api/builds`, `POST /console/api/builds/upload`.

### App downloads (installable APK / IPA)

The **Downloads** tab distributes the actual installable app builds (separate
from OTA JS updates — those only patch an already-installed build). For each
channel (production / preview / staging) and platform you can:

- **Upload** an `.apk` / `.aab` / `.ipa` — streamed to R2 under
  `ota/builds/<app>/<buildId>/`, or
- **Register a link** — an https URL to a store / EAS / CDN build (nothing is
  copied; the console just records the pointer).

Each build gets a **download link** testers can open on-device to install:

- Uploaded builds are served by the worker at `GET /download?key=…` as an
  attachment (restricted to the `ota/builds/` prefix). The link is **public and
  unguessable** (random build UUID) so testers install without the console
  password — the same model as ad-hoc / TestFlight / Diawi links. Delete the
  build to revoke the link.
- Registered builds link straight to their external URL.

Publishing/uploading builds requires the console token; only the resulting
download link is public.

Source layout (no frontend build step — the assets are imported as strings and
bundled into the worker):

```
src/
  index.ts              worker entry: routing + Expo manifest/asset endpoints
  shared.ts             shared types, constants, helpers
  console/
    index.ts            barrel (renderConsolePage, handleConsoleApi)
    auth.ts             bearer-token authorization
    api.ts              /console/api/* request handler
    store.ts            R2 read/manage data layer
    page.ts             assembles the page from assets/
    assets/
      shell.html        page markup (with __STYLES__ / __CLIENT__ slots)
      styles.css.txt    styling
      client.js.txt     client-side app (vanilla JS, no deps)
```

The CSS/JS assets use a `.txt` suffix so the bundler ships them verbatim as
strings; esbuild's built-in `.css`/`.js` loaders would otherwise process them.

**2. In the admin panel** — System → **OTA Updates**, backed by `api-server`
`GET/POST /api/admin/ota/*` (uses the existing admin auth/session). Same
capabilities; use whichever fits your workflow.

---

## Channels (staging vs production)

The client's channel comes from `updates.requestHeaders["expo-channel-name"]`
in `app.json` (default `production`). To run a **staging/QA** track, make a
build whose `app.json` sets that header to `preview`, then publish with
`--channel preview`. Production builds are unaffected.

---

## Rollback

Re-publish the previous known-good JS (fastest), **or** repoint the channel to an
earlier `updateId` that's still in R2:

```bash
# find previous update ids under ota/updates/<app>/ in the R2 dashboard, then:
echo '{"updateId":"<old-id>","runtimeVersion":"1.0.0"}' > pointer.json
npx wrangler r2 object put voxcall/ota/channels/user/production/1.0.0.json \
  --file pointer.json --content-type application/json --remote
```

Clients move back on their next check. (Old update files are never deleted, so
rollback is always possible.)

---

## Optional: code signing (recommended for production)

Signing makes the app **cryptographically verify** every manifest, so even a
compromised update server / R2 bucket can't push malicious JS.

1. Generate a key + self-signed certificate:
   ```bash
   npx @expo/code-signing-certificates generate-certificate \
     --output ./certs --certificate-common-name "VoxCall"
   # produces certs/private-key.pem + certs/certificate.pem
   ```
2. Give the Worker the private key:
   ```bash
   cd ota-server && npx wrangler secret put CODE_SIGNING_PRIVATE_KEY   # paste private-key.pem
   ```
3. Add the certificate to **each** app's `app.json` `updates` block and rebuild:
   ```jsonc
   "updates": {
     "codeSigningCertificate": "./certs/certificate.pem",
     "codeSigningMetadata": { "keyid": "root", "alg": "rsa-v1_5-sha256" }
   }
   ```

Keep the keyid consistent with `CODE_SIGNING_KEY_ID` (default `root`) in
`wrangler.toml`. The Worker signs a manifest only when the client sends
`expo-expect-signature`; if a client asks and the key is missing it fails
closed (never serves an unsigned manifest to a client that requires one).

---

## Notes

- **Validate on a real dev/internal build.** Simulators + Expo Go don't exercise
  `expo-updates`; use an `eas build` (internal/preview) or a local dev build.
- **Never delete published update files** from R2 — clients may fetch any update
  at any time, and it breaks rollback.
- Adding this package to CI is optional; it deploys independently via `wrangler`.
