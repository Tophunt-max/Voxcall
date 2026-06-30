# Calling System Bugs — Status Report

> **Status legend:** ✅ FIXED in code · ⚠️ Tracked TODO · 🔴 Open

---

## Summary

All 8 bugs originally documented here are **FIXED** in the current codebase
(`api-server/src/routes/call.ts` + `api-server/src/types.ts`). One additional
bug of the same class was discovered in the admin panel's force-end endpoint
and has now been fixed too.

> A later deep audit (2026-06-30) found and fixed three more issues — free-minute
> affordability (F1), the stale-call reaper killing healthy long calls (F2), and
> a billing ledger-accuracy race (F3). See **Deep audit — round 2** at the bottom.

| # | Location | Severity | Status |
|---|----------|----------|--------|
| 1 | `call.ts` `/initiate` host lookup | CRITICAL | ✅ FIXED |
| 2 | `call.ts` `/:id/end` coin transfer | CRITICAL — money | ✅ FIXED |
| 3 | `call.ts` CF session pre-creation timeout | HIGH | ✅ FIXED (lazy session) |
| 4 | `call.ts` null `hostRow` reference | HIGH | ✅ FIXED |
| 5 | `call.ts` unsafe `JSON.parse` on track names | MEDIUM | ✅ FIXED |
| 6 | `call.ts` validated body misuse | MEDIUM | ✅ FIXED |
| 7 | type assertions `<any>` everywhere | MEDIUM | ✅ FIXED |
| 8 | silent `catch {}` blocks | LOW | ✅ FIXED |
| 9 | `admin.ts` `/calls/:id/force-end` no atomic transfer | HIGH — money | ✅ FIXED (this round) |

---

## #1 — Incomplete variable reference in `/initiate`  ✅ FIXED

**Original symptom:** `body.host_i[...]` truncated → call initiation crashed
immediately.

**Where it lives now:** `api-server/src/routes/call.ts` — host lookup uses
`body.host_id` correctly through `c.req.valid('json')`.

---

## #2 — Race condition in coin transfer  ✅ FIXED

**Original symptom:** A non-atomic batch deducted the caller conditionally
(`WHERE coins >= ?`) but credited the host unconditionally. If the caller
had insufficient coins, the host got "free" coins.

**Where it lives now:** Both `/end` (legacy) and `/:id/end` use a single
atomic `UPDATE` with a CASE expression and an EXISTS guard:

```sql
UPDATE users
   SET coins = coins + CASE id
     WHEN ?1 THEN -?2
     WHEN ?3 THEN ?4
     ELSE 0
   END
   WHERE id IN (?1, ?3)
     AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND coins >= ?2)
```

Either both rows update (success) or zero rows update (caller short on
coins). No partial states, no duplicate-credit risk. The cron-based stale
reaper (`src/index.ts`) uses the same pattern.

---

## #3 — CF Calls session pre-creation timeout  ✅ FIXED

**Original symptom:** Sessions were minted at `/initiate` and idle-expired
(~30–60s) before WebRTC negotiation, returning `410 session_error`.

**Where it lives now:** Sessions are created **lazily** in `/sdp/push` when
each party actually negotiates, and a session-expired retry path
re-creates a fresh session if the lazy one ages out mid-call.

---

## #4 — Null `hostRow` reference  ✅ FIXED

Both `/end` endpoints check `if (!hostRow)` and return `500` with a
descriptive log, instead of attempting to bind `null` into the host
update / coin_transactions insert.

---

## #5 — Unsafe `JSON.parse` on stored track names  ✅ FIXED

`/:id/sdp/pull` wraps `JSON.parse(storedRemoteNames)` in a `try/catch` and
falls back to `body.trackNames` if the stored value is malformed. Calls no
longer 500 on corrupted DB state.

---

## #6 — Missing input validation  ✅ FIXED

`/initiate` uses `c.req.valid('json')` from the `zValidator` middleware
instead of re-parsing `c.req.json()`, so the typed/validated body is what
reaches the SQL layer.

---

## #7 — Type assertions everywhere  ✅ FIXED

`api-server/src/types.ts` now exports `HostRow`, `CallSessionRow`,
`CallerData`, `HostData`, `UserRow` interfaces. The call routes use these
typed `.first<HostRow>()` / `.first<CallSessionRow>()` reads. `<any>` is
gone from the call hot path.

---

## #8 — Silent error catches  ✅ FIXED

Every `try { ... } catch {}` has been replaced with
`try { ... } catch (e) { console.warn('[/route] context:', e); }`. Notification
failures, FCM failures, CF session close failures, and WS disconnect failures
all surface in the Worker logs now.

---

## #9 — Admin force-end did not transfer coins  ✅ FIXED *(this round)*

**File:** `api-server/src/routes/admin.ts` — `POST /api/admin/calls/:id/force-end`

**Original symptom:** When an admin force-ended a stuck call:
- Session row was updated with `coins_charged = X`, `duration_seconds = Y`
- But the caller's wallet was **not** debited
- The host's wallet was **not** credited
- No `coin_transactions` rows were inserted
- Host `total_minutes` / `total_earnings` stayed stale
- Neither party's call screen received a `call_ended` notification

This was the same class of bug as #2 (admin path was simply never updated
when the user-facing `/end` was rewritten). The TODO comment in the code
explicitly admitted it.

**Fix:** Force-end now mirrors `/api/calls/end` end-to-end:
1. Atomic `ended_at IS NULL` guard prevents double-end races (admin
   force-end racing the cron reaper or a real `/end` call).
2. Round minutes UP (`Math.ceil`) to match the user-facing endpoint —
   floor would under-bill 1m30s calls.
3. Single atomic CASE/EXISTS transfer; insufficient-coin case moves zero
   coins (response includes `insufficient_coins: true`).
4. Bookkeeping batch updates host stats + inserts both `coin_transactions`
   rows only if money actually moved.
5. WS `call_ended` + `coin_update` notifications to both parties so their
   call screens unblock and wallet UI refreshes immediately.
6. Best-effort CF Calls SFU session close so we don't leak edge resources.
7. Audit log line now includes the actual amount moved.

---

## Files reviewed this round

- `api-server/src/routes/call.ts` — verified fixes #1–#8 still in place
- `api-server/src/routes/admin.ts` — applied fix #9
- `api-server/src/types.ts` — verified interfaces still exported
- `api-server/src/index.ts` — cron reaper pattern verified (used as fix #9 reference)

Triple typecheck pass: api-server, voxlink, voxlink-host (all `Exit 0`).


---

## Known limitations (audited 2026-05-30) — not yet code-fixed

These two were identified during the calling-system audit. They are **not**
quick code fixes — each needs either a new native dependency or a deliberate
product decision, so they are documented here rather than patched blindly.

### L1. Speaker / Earpiece button does not actually route audio  ✅ FIXED (2026-05-30)
- **Was:** Tapping *Speaker* toggled the icon but the audio output device did
  not change — `toggleSpeaker` only flipped the `isSpeakerOn` UI flag and there
  was no audio-routing code.
- **Fix:** Added `react-native-incall-manager`. The WebRTC service now calls
  `InCallManager.start({ media })` on call start, `setForceSpeakerphoneOn(on)`
  via a new `setSpeaker()` method (exposed through `useWebRTC`), and
  `InCallManager.stop()` on teardown. Each call screen drives `setSpeaker`
  from an effect on `activeCall.isSpeakerOn`. Video calls default to the
  loudspeaker, audio calls to the earpiece.
- **Build note:** this is a native module. It autolinks via EAS prebuild
  (like `@cloudflare/react-native-webrtc`) — a **new dev/preview build is
  required** for it to take effect; it will not appear in the existing web
  bundle. Added `android.permission.MODIFY_AUDIO_SETTINGS`; iOS already
  declares the `audio`/`voip` background modes. On web there is no output-
  switch API, so `setSpeaker` is a safe no-op (audio plays through the active
  output). Loads behind a `Platform.OS !== 'web'` + try/catch guard, so the
  app degrades gracefully if the native module is missing (pre-rebuild).

### L2. Turning the camera OFF does not release the camera hardware
- **Symptom:** With camera toggled off, the device camera light/handle stays
  active (minor privacy + battery cost).
- **Why it is intentional (for now):** `toggleCamera(false)` sets
  `videoTrack.enabled = false` rather than `videoTrack.stop()`. Keeping the
  track + sender alive means re-enabling is instant and never needs a
  Cloudflare Calls SFU renegotiation. Fully stopping the track would require
  re-acquiring + re-pushing tracks mid-call (a renegotiation path the current
  push flow does not implement) and risks the camera-busy race we just fixed.
- **Recommended fix (larger):** implement a proper mid-call renegotiation path
  so the camera can be fully released on OFF and cleanly re-added on ON. The
  `toggleCamera` re-acquire + `replaceTrack` logic added in this audit is the
  first half of that work (it already re-acquires when a video sender exists).



---

## Deep audit — round 2 (2026-06-30)

A second end-to-end pass over the calling system (client state machine,
signaling, billing, and all three server backstops: client heartbeat, cron
reaper, stuck-call reconcile). The historical bugs above all verified still
fixed. Three new issues found and fixed this round.

| # | Location | Severity | Status |
|---|----------|----------|--------|
| F1 | `call.ts` admission gate + `max_seconds` / heartbeat cap | MEDIUM — revenue/product | ✅ FIXED |
| F2 | `index.ts` stale-call reaper window | MEDIUM — kills healthy long calls | ✅ FIXED |
| F3 | `billing.ts` `chargeCallerWithFreePool` ledger accuracy | LOW — audit-trail integrity | ✅ FIXED |

### F1 — `free_call_minutes` ignored by admission gate + duration caps  ✅ FIXED

**Symptom:** `billing.ts` consumes the user's free-minute pool first at
settlement, but the call-admission gate and every duration cap looked at
`coins / rate` only and ignored free minutes. Two consequences:
- A coinless user **with** free trial minutes was blocked at `/initiate`
  (`coins < rate*2`) — so the free-trial pool could never actually *enable*
  a call.
- `max_seconds` (caller + host timers) and the `/heartbeat` balance cap
  force-ended a call earlier than the caller could really afford, because the
  free portion wasn't credited toward the duration.

**Fix:** New pure helper `affordableCallSeconds(coins, freeMinutes, rate)` in
`lib/billing.ts` (= `(coins/rate)*60 + freeMinutes*60`), now the single source
of truth for affordability. Wired into:
- `POST /api/calls/initiate` — admission gate (`affordable < 120s` → block) and
  the returned `max_seconds`. A coinless caller with free minutes can now call.
- `POST /api/calls/:id/heartbeat` — the balance cap (`max_seconds`/`remaining`).
- `GET  /api/calls/pending-for-host` — the host's incoming-call timer.

Reads `COALESCE(free_call_minutes, 0)` defensively (try/catch falls back to
coins-only on a pre-migration DB). 6 new unit tests in `test/billing.test.ts`.

### F2 — Stale-call reaper force-ended healthy long calls  ✅ FIXED

**Symptom:** The cron reaper (`index.ts → reapStaleCalls`) ended every
`active` call whose `started_at` was older than **30 minutes** — regardless of
whether the call was still healthy. So a genuine 31-minute conversation would
be dropped, *and* a dead-client call still lingered for up to 30 minutes.

**Fix:** Reap by **heartbeat freshness**, not total duration.
- New column `call_sessions.last_heartbeat_at` (migration `0040` +
  `schemaGuard` auto-heal), stamped on every `/heartbeat` (~25s cadence).
- Reaper now ends active calls only when
  `COALESCE(last_heartbeat_at, started_at) < now - 5min` (`HEARTBEAT_STALE_SEC`).
  Healthy calls of any length keep heartbeating and survive; a crashed/idle
  client is reaped within ~5 min instead of 30. The 5-min window tolerates
  brief mobile backgrounding / network blips.

### F3 — Free-pool billing over-reported `charged` in a race  ✅ FIXED

**Symptom:** `chargeCallerWithFreePool` returned `charged = callerActuallyPays`
without checking whether the caller-debit statement actually applied. The
debit is guarded by `WHERE coins >= ?`; if a concurrent debit drained the
caller between the balance read and the batch, the debit matched 0 rows but
the function still reported the amount as charged — so the call routes wrote a
caller-`spend` ledger row for coins that were never deducted (balance/ledger
drift). Extremely narrow (one call per user + single-claim end), but a real
audit-trail integrity gap.

**Fix:** Capture the batch results and zero out the reported `charged` **only**
when the debit statement reports `changes === 0` (the real race). The host is
still paid in full — the platform absorbs the gap, the same intentional model
used for free minutes — but no phantom caller-spend ledger row is written.
Degrades gracefully (keeps the optimistic value) if a runtime doesn't surface
per-statement `changes`, so normal behaviour is unchanged.

### Files changed this round
- `api-server/src/lib/billing.ts` — `affordableCallSeconds` helper (F1) + debit-verify (F3)
- `api-server/src/routes/call.ts` — gate/caps wired to free minutes (F1) + heartbeat freshness stamp (F2)
- `api-server/src/lib/schemaGuard.ts` — `last_heartbeat_at` column (F2)
- `api-server/src/index.ts` — heartbeat-freshness reaper (F2)
- `api-server/migrations/0040_call_heartbeat_freshness.sql` — new column + partial index (F2)
- `api-server/test/billing.test.ts` — 6 new `affordableCallSeconds` tests

**Verified:** api-server typecheck clean, lint 0 errors, **202 backend tests pass**.

### Still open (product / architectural decisions — not code bugs)
- **Client-driven balance cap:** the hard balance stop still depends on the
  caller's client posting heartbeats. If the app is backgrounded/offline the
  cap isn't enforced until the reaper (now ~5 min). The caller is always capped
  at their balance (no platform loss), but a host can give some unpaid talk
  time. A host-side heartbeat or a server-authoritative billing clock would
  close this fully — deferred as a larger change.
