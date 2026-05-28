# 📱 User & Host App Issues — Detailed Analysis

## Overview
Host और User apps में multiple issues हैं जो calls, payments, और notifications को affect कर रहे हैं।

---

## 🔴 CRITICAL ISSUES

### **APP ISSUE #1: Incomplete API Call in api.ts (Line 195)**
**File:** `voxlink/services/api.ts` **Line 195**

### The Bug
```typescript
// WRONG ❌
pullTracks: (sessionId: string, trackNames: string[]) =>
  apiRequest<{ offer: { type: string; sdp: string } | null; tracks: Array<{ mid?: string; trackName?: string; errorCode?: string }>; role: string; retryable?: boolean }>('POST', `/api/calls/${s[...]
//                                                                                                                                                                                    ↑↑↑ INCOMPLETE!
```

**Impact:** 
- Pull tracks call crash करेगी
- WebRTC negotiation fail हो सकता है
- Call audio/video corrupt हो सकता है

### Fix
```typescript
pullTracks: (sessionId: string, trackNames: string[]) =>
  apiRequest<{ offer: { type: string; sdp: string } | null; tracks: Array<{ mid?: string; trackName?: string; errorCode?: string }>; role: string; retryable?: boolean }>('POST', `/api/calls/${sessionId}/sdp/pull`, { trackNames }),
```

---

## 🟠 HIGH PRIORITY ISSUES

### **APP ISSUE #2: Incoming Call Auto-Decline Timeout (30 seconds)**
**File:** `voxlink-host/app/calls/incoming.tsx` **Lines 51-58**

### The Bug
```typescript
useEffect(() => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const timeout = setTimeout(async () => {
    await stopRing();
    declineCall();  // ← 30 seconds में auto-decline हो जाता है
  }, 30000);       // ← TOO SHORT! Caller 45 seconds wait करता है
  return () => clearTimeout(timeout);
}, [stopRing, declineCall]);
```

**Problem:**
- Caller 45 seconds ring करता है (`RING_TIMEOUT_MS = 45000` in outgoing.tsx)
- Host के लिए 30 seconds timeout है
- Host auto-decline हो जाता है जबकि caller अभी ring कर रहा है
- **Race condition:** Host screen बंद हो जाता है लेकिन caller stuck रहता है

### Fix
```typescript
const RING_TIMEOUT_MS = 45000; // Host app incoming.tsx में भी same timeout use करें
useEffect(() => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const timeout = setTimeout(async () => {
    await stopRing();
    declineCall();
  }, RING_TIMEOUT_MS); // 45 seconds — caller के साथ sync
  return () => clearTimeout(timeout);
}, [stopRing, declineCall]);
```

---

### **APP ISSUE #3: Outgoing Call Timeout (45 seconds)**
**File:** `voxlink/app/user/call/outgoing.tsx` **Lines 73-80**

### Current Implementation (GOOD ✅)
```typescript
// Fix C2: no-answer timeout — end call after 45s if host doesn't respond
const t2 = setTimeout(async () => {
  if (!navigated.current) {
    setStatus("no_answer");
    await stopRing();
    setTimeout(() => endCall(false), 1500);
  }
}, RING_TIMEOUT_MS); // 45 seconds
```

**Status:** ✅ Already fixed (साथ में incoming.tsx को sync करना है)

---

### **APP ISSUE #4: Silent Error in updateAvatar (Line 116)**
**File:** `voxlink/services/api.ts` **Lines 116-133**

### The Bug
```typescript
updateAvatar: async (formData: FormData, _retry = true): Promise<any> => {
  // Bug 6 Fix: Use shared token getter with 401 auto-refresh (same as apiRequest)
  let token = await getToken();
  const res = await fetch(`${BASE_URL}/api/upload/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (res.status === 401 && _retry) {
    const newToken = await refreshAuthToken();
    if (newToken) return API.updateAvatar(formData, false);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));  // ← Silent catch!
    throw new Error((err as any).error || 'Avatar upload failed');
  }
  return res.json();
},
```

**Impact:**
- If JSON parsing fails, error silently caught
- User को नहीं पता चलता की upload fail हुआ
- Empty error object से generic message return होता है

### Fix
```typescript
updateAvatar: async (formData: FormData, _retry = true): Promise<any> => {
  let token = await getToken();
  const res = await fetch(`${BASE_URL}/api/upload/avatar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (res.status === 401 && _retry) {
    const newToken = await refreshAuthToken();
    if (newToken) return API.updateAvatar(formData, false);
  }
  if (!res.ok) {
    let errorMsg = 'Avatar upload failed';
    try {
      const err = await res.json();
      errorMsg = (err as any).error || errorMsg;
    } catch (parseErr) {
      console.error('[updateAvatar] JSON parse failed:', parseErr, 'Response:', res.statusText);
    }
    throw new Error(errorMsg);
  }
  return res.json();
},
```

---

### **APP ISSUE #5: Same Issue in uploadFile (Lines 134-151)**
**File:** `voxlink/services/api.ts` **Lines 134-151**

**Same problem as #4** — silent catch() in JSON parse

---

## 🟡 MEDIUM PRIORITY ISSUES

### **APP ISSUE #6: Host Acceptance Race Condition**
**File:** `voxlink-host/context/CallContext.tsx` **Lines 76-117**

### The Issue
```typescript
const acceptCall = useCallback(async () => {
  const curr = activeCallRef.current;
  if (!curr) return;
  if (isAcceptingRef.current) return;  // ← Good guard
  isAcceptingRef.current = true;

  let serverStartedAtMs = Date.now();
  if (curr.sessionId) {
    try {
      const res = await API.answerCall(curr.sessionId, true);
      if (res?.started_at) serverStartedAtMs = res.started_at * 1000;
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      // Soft errors (network, timeout) को optimistically continue करता है
      // ⚠️ Host को billing timer के साथ proceed करने दो
      // लेकिन caller को caller की startTime भेजने में mismatch हो सकता है
      console.warn("answerCall soft error, continuing:", e);
    }
  }

  // router.replace की जगह router.push — modal stack issue
  router.push(curr.type === "audio" ? "/calls/audio-call" : "/calls/video-call");
}, []);
```

**Problem:**
- Soft errors (network) में host proceed करता है
- लेकिन server-side accept confirm नहीं हुआ
- Billing mismatch हो सकता है

### Fix
```typescript
const acceptCall = useCallback(async () => {
  const curr = activeCallRef.current;
  if (!curr) return;
  if (isAcceptingRef.current) return;
  isAcceptingRef.current = true;

  let serverStartedAtMs = Date.now();
  let acceptSucceeded = false;
  
  if (curr.sessionId) {
    try {
      const res = await API.answerCall(curr.sessionId, true);
      if (res?.started_at) serverStartedAtMs = res.started_at * 1000;
      acceptSucceeded = true;
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      const isHardFail =
        msg.includes("not found") ||
        msg.includes("not authorized") ||
        msg.includes("declined") ||
        msg.includes("ended");
      
      if (isHardFail) {
        // Hard fail — abort the call
        isAcceptingRef.current = false;
        updateCall(null);
        return;
      }
      
      // Soft error — optimistically proceed
      console.warn("answerCall soft error, continuing:", e);
      acceptSucceeded = true;
    }
  }

  if (!acceptSucceeded && curr.sessionId) {
    // Server accept confirm नहीं हुआ
    isAcceptingRef.current = false;
    updateCall(null);
    return;
  }

  const updated = { ...curr, status: "active" as CallStatus, startTime: serverStartedAtMs };
  updateCall(updated);
  isAcceptingRef.current = false;
  router.push(curr.type === "audio" ? "/calls/audio-call" : "/calls/video-call");
}, []);
```

---

### **APP ISSUE #7: Call Duration Calculation Drift**
**File:** `voxlink/context/CallContext.tsx` **Lines 142-157** (User App)
**File:** `voxlink-host/context/CallContext.tsx` **Lines 137-151** (Host App)

### The Issue
```typescript
const endCall = useCallback(async (autoEnded = false) => {
  const call = activeCallRef.current;
  const wasActive = !!(call?.startTime);
  const duration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
  //                                        ↑ Client-side time calculation
  // ⚠️ Client time vs Server time mismatch!
  // Network delay, clock skew से duration गलत calculate हो सकता है
  
  updateCall(null);
  if (!wasActive) {
    if (call?.sessionId) {
      try { await API.endCall(call.sessionId, 0); } catch {}
    }
    return;
  }
```

**Problem:**
- Client-side time calculation unreliable है
- Network delay में duration का error आ सकता है
- Server-side calculation से mismatch हो सकता है

### Fix
```typescript
const endCall = useCallback(async (autoEnded = false) => {
  const call = activeCallRef.current;
  const wasActive = !!(call?.startTime);
  // Client-side duration calculate करो लेकिन server को decide करने दो
  const clientDuration = wasActive ? Math.floor((Date.now() - call!.startTime!) / 1000) : 0;
  
  updateCall(null);
  if (!wasActive) {
    if (call?.sessionId) {
      try { await API.endCall(call.sessionId, 0); } catch {}
    }
    return;
  }

  let finalDuration = clientDuration;
  if (call?.sessionId) {
    try {
      // Server को send करो �� server accurate duration return करेगा
      const res = await API.endCall(call.sessionId, clientDuration);
      if (res?.duration_seconds != null) {
        finalDuration = res.duration_seconds; // Server duration use करो
      }
    } catch (e: any) {
      console.warn("endCall API error:", e);
      // Server agree न करे तो client duration use करो
    }
  }
  
  // Use finalDuration for billing
}, [updateCoins]);
```

---

## 🔵 LOW PRIORITY ISSUES

### **APP ISSUE #8: Missing Error Boundary in Host App**
**File:** `voxlink-host/app/(tabs)/index.tsx` (और other screens)

**Issue:** No try-catch या error boundary अगर host profile load fail हो

### **APP ISSUE #9: Unhandled Promise Rejections in Socket Context**
**File:** `voxlink/context/SocketContext.tsx` **Lines 67-75**

```typescript
const sendMessage = useCallback(
  (chatId: string, _senderName: string, text: string) => {
    API.sendMessage(chatId, text).catch((err) =>
      console.warn("[SocketContext] sendMessage failed:", err)
    );
    // ✅ Already has error handling
  },
  []
);
```

**Status:** ✅ Already handled properly

---

## 📋 Summary Table

| # | Location | Severity | Type | Impact |
|---|----------|----------|------|--------|
| 1 | api.ts:195 | **CRITICAL** | Incomplete API call | WebRTC crashes |
| 2 | incoming.tsx:53 | **HIGH** | Timeout mismatch | Host auto-decline |
| 3 | outgoing.tsx:74 | **GOOD** | Already fixed | ✅ |
| 4 | api.ts:116 | **HIGH** | Silent error | Avatar fail hidden |
| 5 | api.ts:134 | **HIGH** | Silent error | Upload fail hidden |
| 6 | CallContext:76 | **MEDIUM** | Race condition | Billing drift |
| 7 | CallContext:142 | **MEDIUM** | Time drift | Duration mismatch |
| 8 | Various | **LOW** | No error boundary | Crashes on fail |
| 9 | Socket | **GOOD** | Already handled | ✅ |

---

## 🎯 Priority Fix Order

1. **FIX #1 IMMEDIATELY** — WebRTC काम ही नहीं करेगी
2. **FIX #2 & #4 & #5** — User experience issues
3. **FIX #6 & #7** — Billing accuracy
4. **FIX #8** — Error boundaries

---

## ✅ Files to Update

- [ ] `voxlink/services/api.ts` — Fix incomplete pullTracks call + silent catches
- [ ] `voxlink-host/app/calls/incoming.tsx` — Sync timeout with outgoing.tsx
- [ ] `voxlink/context/CallContext.tsx` — Server duration validation
- [ ] `voxlink-host/context/CallContext.tsx` — Better soft error handling
