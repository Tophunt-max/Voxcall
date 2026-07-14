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
> **store build**. `runtimeVersion` (policy `appVersion`) enforces this: a build
> only accepts updates published under its own runtime version, so an old native
> build can never pull incompatible JS.

---

## R2 layout (all under the `ota/` prefix)

```
ota/updates/<app>/<updateId>/update.json               ← precomputed manifest record
ota/updates/<app>/<updateId>/_expo/static/js/…         ← the JS/Hermes bundle
ota/updates/<app>/<updateId>/assets/<hash>             ← images, fonts, etc.
ota/channels/<app>/<channel>/<runtimeVersion>.json     ← { updateId } pointer (what's live)
```

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

The script runs `expo export`, hashes + uploads everything to R2, and makes the
update live on the `production` channel for the current `runtimeVersion`
(= the app's `version` in `app.json`). Installed apps pick it up on their next
launch (downloaded in the background; applied on the following restart because
`fallbackToCacheTimeout: 0`).

Options:
- `--channel preview` — publish to a separate channel (see below).
- `--runtime-version 1.2.0` — override (defaults to `app.json` version).

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
