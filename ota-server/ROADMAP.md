# VoxCall OTA — feature roadmap

Tracks OTA server features: what shipped in the "safety + ops" batch and what
is designed but deferred. Nothing here changes app behaviour until the relevant
secret/config is set — everything is safe-by-default (off).

## Shipped

### 1. Rollback to embedded (kill-switch)
Instantly pull a bad OTA update: the channel starts serving a
`rollBackToEmbedded` **directive** (Expo Updates protocol v1) so devices revert
to the bundle shipped in their installed build on the next check.
- Console: **Channels → Roll back to embedded**.
- API: `POST /console/api/rollback { app, channel }`.

### 2. Client health + optional auto-rollback
The app reports update apply/launch outcomes; the server aggregates a
success/failure count per update and shows it on **Channels** (healthy / % fail).
- Public endpoint: `POST /report { app, updateId, status: "ok"|"error", message? }`.
- Auto-rollback is **opt-in**: set `AUTO_ROLLBACK_FAILURE_PCT` (+ optional
  `AUTO_ROLLBACK_MIN_SAMPLE`, default 20). Above the threshold, live channels
  serving that update are rolled back to embedded automatically. Unset ⇒ health
  is only recorded (roll back manually).
- **Client wiring** (add to each app, e.g. `voxlink/App.tsx`):
  ```ts
  import * as Updates from 'expo-updates';
  const OTA = 'https://<ota-host>/report';
  const APP = 'user'; // 'host' in voxlink-host
  function report(status: 'ok' | 'error', message?: string) {
    const updateId = Updates.updateId; // null when running the embedded bundle
    if (!updateId) return;
    fetch(OTA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: APP, updateId, status, message }),
    }).catch(() => {});
  }
  // After the app boots successfully on a new update:
  report('ok');
  // In your global error handler / Updates error listener:
  // report('error', String(err));
  ```

### 3. Audit log
Every mutation (promote, rollback, rollout, mandatory toggle, build add/delete,
auto-rollback) is recorded. Console: **Activity** tab. API: `GET /console/api/audit`.

### 4. Scoped publish token
CI/scripts can use `PUBLISH_TOKEN` (build endpoints only) instead of the human
`CONSOLE_PASSWORD`. A leaked CI token can add builds but never touch rollout.
CI reads `secrets.OTA_PUBLISH_TOKEN` (falls back to `OTA_CONSOLE_PASSWORD`).

### 5. Event notifications
Set `NOTIFY_WEBHOOK_URL` (Slack / Discord / generic) to get a message on
promote / rollback / auto-rollback / new build / retention sweep.

### 6. Retention / cleanup
Daily cron prunes updates + builds older than `RETENTION_DAYS` (live pointers +
the newest ~20 are always kept). Unset ⇒ disabled.

### 7. Mobile install page (iOS OTA + Android)
Public `/install/<app>/<buildId>` landing page: Android taps the APK; iOS installs
over-the-air via an `itms-services` manifest (`/install/<app>/<buildId>/manifest.plist`).
Console: **Downloads → Install page** on each build. (iOS OTA install needs an
ad-hoc-signed `.ipa` on a registered device.)

## Deferred (designed, not yet built)

- **Targeted rollout** — beyond % bucketing: target by app version, platform, or
  a test-device allowlist (internal testers first). Extends channel pointers with
  match rules checked in `serveManifest`.
- **Scheduled / gradual rollout** — auto-advance 10%→50%→100% over time with
  auto-halt on failure spike. Needs a schedule record + the existing cron.
- **Richer analytics** — adoption-over-time, adoption lag, retention charts.
  Requires time-bucketed metric collection (currently point-in-time counts).
- **Multi-user auth + roles** — viewer vs deployer; ideally SSO with the main
  admin panel instead of a shared password.
- **Bundle-size tracking + diff** — store per-update bundle size and diff two
  updates. `publish.mjs` already computes per-asset sizes.
- **QR image on the install page** — currently a shareable link; add a rendered
  QR (small vendored encoder or a build-time dep).
