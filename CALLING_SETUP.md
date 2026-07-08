# Calling Setup — Agora RTC (single provider)

> **Provider model (2026):** Voxcall's audio/video calls run **exclusively on
> Agora RTC**. The Cloudflare Realtime SFU + TURN path has been fully removed.
> The backend mints a short-lived join token per call and both clients join the
> same Agora channel (the channel name = the call session id).

Both the **user app** (`voxlink`) and the **host app** (`voxlink-host`) share
the same backend Worker (`voxlink-api`), so configuring Agora once enables
calling in **both** apps.

> If calls fail with **"Agora not configured — contact admin to set
> AGORA_APP_ID / AGORA_APP_CERTIFICATE"**, the credentials below are missing on
> the Worker.

---

## Required Worker config (`voxlink-api`)

| Variable | What | Where to get it |
|---|---|---|
| `AGORA_APP_ID` | Agora project **App ID** | [console.agora.io](https://console.agora.io) → your project |
| `AGORA_APP_CERTIFICATE` | Agora project **primary certificate** (secret — signs RTC tokens) | Same project → enable App Certificate / token auth |

Both are **runtime Worker secrets** (the backend reads them at request time when
minting tokens) — they go on the **Cloudflare Worker**, NOT in the static web
build. Create the project with **App Certificate / token authentication
enabled**.

### Set the credentials

```bash
cd api-server
npx wrangler secret put AGORA_APP_ID           # Agora project App ID
npx wrangler secret put AGORA_APP_CERTIFICATE  # Agora primary certificate (secret)
```

Secrets take effect immediately — no redeploy needed. Verify with
`GET /api/calls-config-status` (or `/health`) → it should report
`rtc_provider: "agora"` and `calling_ready: true`.

You can also set them via **Cloudflare Dashboard → Workers → voxlink-api →
Settings → Variables and Secrets**, or via matching **GitHub repo secrets** if
`deploy-backend.yml` is wired to push them on deploy.

---

## ⚠️ Mobile clients need a NEW native build

`react-native-agora` is a **native module** that autolinks during EAS prebuild
(the same way `react-native-incall-manager` does). So:

- **Web** uses the Agora **web** SDK (`agora-rtc-sdk-ng`) and works with **no
  rebuild**.
- **Android / iOS** require a fresh **dev/preview/production EAS build** before
  Agora calls work on device. There is no JS-only fallback anymore, so an old
  build (that still had the Cloudflare WebRTC native module) will **not** place
  calls until rebuilt.

---

## How calling works (end to end)

1. Caller hits `POST /api/calls/initiate` → creates a `call_sessions` row
   (`pending`) and returns `rtc_provider: "agora"` + `session_id`.
2. Host accepts via `POST /api/calls/:id/answer` → row goes `active`.
3. Each client calls `GET /api/calls/:id/agora-token` → `{ app_id, channel,
   uid, token }`. `channel` = session id, `uid` = 0 (Agora auto-assigns; the
   token is valid for any uid). Only the two authorized participants
   (`deriveRole`) can mint a token for a session.
4. The client joins the channel with the Agora SDK and publishes mic (+ camera
   for video calls).

### Client code map
- `hooks/useWebRTC.ts` — fetches the Agora token and drives one `AgoraService`.
  `provider` is always `"agora"`.
- `services/agora.ts` — `AgoraService`: native via `react-native-agora`, web via
  `agora-rtc-sdk-ng`. Same lifecycle the call screens use
  (`start`/`toggleMute`/`toggleCamera`/`setSpeaker`/`switchCamera`/`destroy`).
- `components/RtcVideoView.tsx` — **native** renders video by `uid` through
  Agora's `RtcSurfaceView`; **web** renders the SDK's `MediaStreamTrack`s in a
  `<video>` element. Audio is routed by the Agora engine (native) or the audio
  element (web).
- In-call mic/camera state is relayed to the peer over
  `POST /api/calls/:id/media-state` (WS `peer_media_state`) so the camera-off
  avatar / muted badge update instantly — this is transport-agnostic.

### Billing / signalling unchanged
Call initiation, the atomic coin transfer, the heartbeat balance cap, the cron
reaper, ratings, and all WS notifications are **provider-agnostic** — they key
off the `call_sessions` row, not the media transport. (The unused
`cf_session_id` / `cf_host_session_id` columns remain on the table for
historical rows but are no longer written or read.)

---

## Why a managed SDK (Agora) over self-hosted SFU / P2P

Voxcall is a **1:1 paid marketplace call** (user ↔ host):

- **Weak-network quality** — Agora's global SD-RTN handles packet loss / jitter
  and NAT traversal (its own TURN-equivalent), so no separate TURN key is needed
  and mobile-data calls connect reliably.
- **Privacy** — peers never exchange IPs (unlike P2P).
- **Accurate billing** — the server still knows a call is live (heartbeat cap +
  cron reaper) independent of the media path.
- **Future group calls** — the channel model scales to 3+ participants.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Agora not configured — contact admin…" | `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` missing on Worker | Set both, then re-check `/api/calls-config-status` |
| Android/iOS call never starts, web works | App build predates the Agora native module | Ship a new EAS build |
| `Agora error 110 / token expired` | Token invalid — wrong certificate, or clock skew | Re-copy the **primary certificate** for the correct App ID |
| Calls connect but no audio/video | Mic/camera permission denied on client | Grant permissions (the app prompts) |
| Join fails with an App ID error | Token auth not enabled on the Agora project | Enable App Certificate / token authentication |

---

## Current state (in code)

- `api-server/src/lib/agoraToken.ts` — Workers-native Agora RTC token generator
  (legacy "006" AccessToken format, no Node deps).
- `api-server/src/routes/call.ts` — `initiate` / `answer` / `end` / `heartbeat`
  / `media-state` / `quality` + `GET /api/calls/:id/agora-token`. Returns
  `rtc_provider: "agora"`.
- `voxlink` + `voxlink-host` — `services/agora.ts`, `hooks/useWebRTC.ts`,
  `components/RtcVideoView.tsx` implement the client side.

> Enabling calls is purely about setting the two Agora secrets above on the
> `voxlink-api` Worker (and shipping a native build for mobile).
