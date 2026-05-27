# 🐛 Calling System Bugs — Detailed Analysis

## Overview
The calling system mein **critical bugs** hain jo calls fail, hang, aur money loss ka reason ban sakte hain.

---

## 🔴 BUG #1: Incomplete Variable Reference (CRITICAL)
**File:** `api-server/src/routes/call.ts` **Line 48**

### The Bug
```typescript
// WRONG ❌
const host = await db.prepare('SELECT id, coins_per_minute, ...')
  .bind(body.host_i[...])  // ← INCOMPLETE! Should be body.host_id
```

**Impact:** Call initiation **immediately crashes** with "undefined property" error.

### Fix
```typescript
// CORRECT ✅
const host = await db.prepare('SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1')
  .bind(body.host_id)
```

---

## 🔴 BUG #2: Race Condition in Coin Transfer (CRITICAL - MONEY BUG)
**File:** `api-server/src/routes/call.ts` **Lines 572-687** (the second `/end` endpoint)

### The Bug
```typescript
// WRONG ❌ (in the second /end endpoint)
batchOps.push(
  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?')
    .bind(coinsCharged, session.caller_id, coinsCharged),
  db.prepare('UPDATE hosts SET total_earnings = total_earnings + ? WHERE id = ?')
    .bind(hostShare, session.host_id),
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?')
    .bind(hostShare, hostRow?.user_id),
);

// Later, only if this fails:
if (!deductResult?.meta?.changes || deductResult.meta.changes === 0) {
  console.error('[/:id/end] Coin deduction failed...');
  await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?')
    .bind(hostShare, hostRow?.user_id).run();
}
```

**Problem:** 
- If caller has **insufficient coins**, the `WHERE coins >= ?` fails silently (SQL doesn't error)
- But the host **STILL gets credited** (unconditional statement)
- This creates **free coins out of thin air** 💸

**Scenario:**
1. Caller has 3 coins, call costs 5 coins
2. Deduction tries: `coins = coins - 5 WHERE coins >= 5` → **no rows affected** ✓ (correct)
3. But host credit still runs: `coins = coins + 3.5` → **EXECUTES** ❌ (WRONG!)
4. Result: Host gets paid, caller doesn't lose coins = **inflation**

### Fix
Use **atomic CASE expression** (already implemented in first `/end` endpoint, lines 193-202):

```typescript
// CORRECT ✅ - Atomic transfer, both-or-nothing
const transfer = await db.prepare(
  `UPDATE users
     SET coins = coins + CASE id
       WHEN ?1 THEN -?2
       WHEN ?3 THEN ?4
       ELSE 0
     END
     WHERE id IN (?1, ?3)
       AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND coins >= ?2)`
).bind(session.caller_id, coinsCharged, hostRow.user_id, hostShare).run();

// changes === 2 means BOTH rows updated (success)
// changes === 0 means caller had insufficient coins; NOTHING moves
if (transfer.meta?.changes === 2) {
  actualCoinsCharged = coinsCharged;
  actualHostShare = hostShare;
}
```

---

## 🟠 BUG #3: WebRTC Session Timeout Loop
**File:** `api-server/src/routes/call.ts` **Lines 83-86**

### The Bug
```typescript
// COMMENT explains the issue:
// "CF Calls sessions idle-timeout in ~30-60s. Pre-creating them means by the time
//  the host accepts and WebRTC negotiation starts, they are already expired (→ 410 session_error)."
```

**What Happens:**
1. Caller initiates → CF session created early but NOT STORED
2. Call sits in "pending" state for 60+ seconds
3. Host finally accepts the call
4. WebRTC tries to use that session → **expired** (410 error)
5. Call dies silently or shows cryptic error

**Affected Code:** Line 87-90 stores `null` instead of real session IDs
```typescript
await db.prepare(
  'INSERT INTO call_sessions (..., cf_session_id, cf_host_session_id, ...) VALUES (..., null, null, ...)'
).run();
```

### Fix (Already Partially Implemented)
Sessions are created **lazily** on first `/sdp/push` call (line 399-410). But add **timeout warning**:

```typescript
// Add to outgoing call screen (voxlink/app/user/call/outgoing.tsx)
const RING_TIMEOUT_MS = 45000; // 45 seconds — if no answer, auto-decline

if (timeout expires) {
  // Host didn't accept → end call gracefully
  await endCall(true);
}
```

---

## 🟠 BUG #4: Null Reference in Host Row
**File:** `api-server/src/routes/call.ts` **Lines 605, 627**

### The Bug
```typescript
const hostRow = await db.prepare(
  'SELECT coins_per_minute, ... FROM hosts WHERE id = ?'
).bind(session.host_id).first<any>();

// ... no null check, then:
.bind(hostShare, hostRow?.user_id)  // ← hostRow could be null!
```

**Impact:** If host deleted/banned mid-call:
- Transaction inserts with `null` host user_id
- Host earnings tracked as `null`
- Money loss for host

### Fix
```typescript
if (!hostRow) {
  console.error('[/:id/end] Host not found for session', sessionId);
  return c.json({ error: 'Host data missing' }, 500);
}
```

---

## 🟠 BUG #5: Unsafe JSON Parsing
**File:** `api-server/src/routes/call.ts` **Line 507**

### The Bug
```typescript
const storedRemoteNames = role === 'caller' 
  ? session.cf_host_track_names 
  : session.cf_caller_track_names;

const trackNamesToUse = storedRemoteNames 
  ? JSON.parse(storedRemoteNames)  // ← Can throw!
  : body.trackNames;
```

**Impact:** If stored track names are corrupted:
- `JSON.parse()` throws uncaught exception
- Call crashes with 500 error
- Remote can't connect

### Fix
```typescript
let trackNamesToUse = body.trackNames;
if (storedRemoteNames) {
  try {
    trackNamesToUse = JSON.parse(storedRemoteNames);
  } catch (e) {
    console.warn('[sdp/pull] Malformed track names, using request body:', e);
    // Fall back to request body
  }
}
```

---

## 🟠 BUG #6: Missing Input Validation
**File:** `api-server/src/routes/call.ts` **Lines 25-48**

### The Bug
```typescript
const initiateSchema = z.object({
  host_id: z.string().min(1),  // ✓ Validated as non-empty string
  type: z.enum(['audio', 'video']).optional(),
});

// But then:
const host = await db.prepare(...)
  .bind(body.host_i[...])  // ← Line 48: Not using validated body correctly!
```

### Fix
```typescript
const body = c.req.valid('json');  // Already validated by zValidator
const host = await db.prepare(
  'SELECT id, coins_per_minute, audio_coins_per_minute, video_coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1'
).bind(body.host_id).first<any>();
```

---

## 🟡 BUG #7: Type Safety Issues (Type Assertions)
**File:** Throughout `api-server/src/routes/call.ts`

### The Bug
```typescript
const host = await db.prepare(...).first<any>();  // Line 48
const caller = await db.prepare(...).first<any>();  // Line 76
const hostRow = await db.prepare(...).first<any>();  // Line 163
// ... 20+ more instances
```

**Issue:** `<any>` bypasses TypeScript entirely — errors hide until runtime.

### Fix
Define proper interfaces:

```typescript
interface HostRow {
  id: string;
  coins_per_minute: number;
  audio_coins_per_minute?: number;
  video_coins_per_minute?: number;
  user_id: string;
  total_minutes?: number;
  total_earnings?: number;
}

interface UserRow {
  id: string;
  coins: number;
  name?: string;
  fcm_token?: string;
}

// Then:
const host = await db.prepare(...).first<HostRow>();
const caller = await db.prepare(...).first<UserRow>();
```

---

## 🟡 BUG #8: Silent Error Catches
**File:** `api-server/src/routes/call.ts` **Lines 101, 119, 244, 256, 270-271**

### The Bug
```typescript
try {
  // Notification attempt
} catch {}  // ← Silently swallows errors
```

**Issue:** If notification fails (DB down, WebSocket dead), it's hidden. Admin has no idea calls aren't notifying.

### Fix
```typescript
try {
  const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
  const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
  await notifStub.fetch('https://dummy/notify', {
    method: 'POST',
    body: JSON.stringify({ type: 'incoming_call', ... }),
  });
} catch (e) {
  // Log but don't fail — notifications are best-effort
  console.warn('[incoming_call] Notification failed:', e?.message);
}
```

---

## 📋 Summary Table

| # | Location | Severity | Type | Impact |
|---|----------|----------|------|--------|
| 1 | Line 48 | **CRITICAL** | Incomplete variable | Calls never initiate (crash) |
| 2 | Lines 572-687 | **CRITICAL** | Race condition | Host gets free coins (money loss) |
| 3 | Lines 83-86 | **HIGH** | Session timeout | WebRTC expired before use |
| 4 | Lines 605, 627 | **HIGH** | Null reference | Null host_id in DB |
| 5 | Line 507 | **MEDIUM** | Unhandled exception | Call crashes on corrupted data |
| 6 | Line 48 | **MEDIUM** | Missing validation | Type mismatch |
| 7 | Multiple | **MEDIUM** | Type assertions | Hide errors until runtime |
| 8 | Multiple | **LOW** | Silent errors | Admin blind to failures |

---

## 🎯 Priority Fix Order

1. **FIX BUG #1 FIRST** — Without this, calls don't work at all
2. **FIX BUG #2 IMMEDIATELY** — Money is being created from nothing
3. **FIX BUG #4** — Prevent null host data in transactions
4. **FIX BUG #5** — Prevent crashes on corrupted data
5. **FIX BUG #8** — Add logging for observability
6. Refactor with proper TypeScript interfaces (BUG #7)

---

## ✅ Files to Update

- [ ] `api-server/src/routes/call.ts` — Fix coins, validations, null checks, JSON parsing
- [ ] `api-server/src/types.ts` — Add `HostRow`, `UserRow`, `CallSessionRow` interfaces
- [ ] `voxlink/app/user/call/outgoing.tsx` — Add ring timeout
- [ ] `voxlink-host/app/calls/incoming.tsx` — Add similar timeout
