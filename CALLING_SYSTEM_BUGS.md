# Calling System Bugs — Status Report

> **Status legend:** ✅ FIXED in code · ⚠️ Tracked TODO · 🔴 Open

---

## Summary

All 8 bugs originally documented here are **FIXED** in the current codebase
(`api-server/src/routes/call.ts` + `api-server/src/types.ts`). One additional
bug of the same class was discovered in the admin panel's force-end endpoint
and has now been fixed too.

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

### L1. Speaker / Earpiece button does not actually route audio
- **Symptom:** Tapping *Speaker* toggles the icon but the audio output device
  does not change.
- **Cause:** There is no audio-routing code anywhere in the apps. The only
  `Audio.setAudioModeAsync` call lives in `useRingtone.ts` (for ringtone
  playback) and does **not** control the live WebRTC audio session.
  `toggleSpeaker` in `CallContext` only flips a UI flag (`isSpeakerOn`).
- **Web:** there is no earpiece concept and no API to switch output, so the
  toggle is effectively a no-op (audio always plays through the active device).
- **Native fix (requires a dependency + dev build):** add
  `react-native-incall-manager` and call
  `InCallManager.setForceSpeakerphoneOn(isSpeakerOn)` (and `start()/stop()` on
  call begin/end). This needs an Expo config plugin and a new native build —
  it cannot be hot-shipped to the existing web bundle.
- **Interim option:** hide/disable the Speaker button on web so it is not
  misleading.

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
