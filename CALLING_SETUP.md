# Calling Setup — Cloudflare Realtime (SFU + TURN)

Voxcall's audio/video calls run on **Cloudflare Realtime**:

- **Realtime SFU** (formerly "Calls") — routes media. Each party publishes its
  audio/video to the SFU, which forwards it to the other party. Used by
  `api-server/src/lib/cf-calls.ts` (`https://rtc.live.cloudflare.com/v1/apps`).
- **Realtime TURN** — NAT traversal so clients behind mobile data / firewalls
  can still connect. Served via `GET /api/calls/ice-config`.

Both the **user app** and the **host app** share the same backend Worker
(`voxlink-api`), so configuring the Worker once fixes calling in **both** apps.

> If calls fail with **"CF Calls not configured — contact admin to set
> CF_CALLS_APP_SECRET"**, the credentials below are missing on the Worker.

---

## Required Worker config (`voxlink-api`)

| Variable | What | Where to get it |
|---|---|---|
| `CF_CALLS_APP_ID` | Realtime SFU **App ID** | Cloudflare Dashboard → Realtime → your app |
| `CF_CALLS_APP_SECRET` | Realtime SFU **App Secret** (secret) | Same app (shown once at creation) |
| `TURN_KEY_ID` | Realtime **TURN Key ID** | Cloudflare Dashboard → Realtime → TURN |
| `TURN_KEY_TOKEN` | Realtime **TURN Key Token** (secret) | Same TURN key |
| `CF_ACCOUNT_ID` | Cloudflare account id | Already a deploy var (`b592b3b2…`) |

All of these are **runtime Worker secrets** (the backend reads them at request
time) — they go on the **Cloudflare Worker**, NOT in the static web build.


---

## How to set the credentials

### Option A — wrangler CLI (fastest)
```bash
cd api-server
npx wrangler secret put CF_CALLS_APP_ID        # paste App ID
npx wrangler secret put CF_CALLS_APP_SECRET    # paste App Secret
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_TOKEN
# CF_ACCOUNT_ID: add as a secret too if not already present on the Worker
```
Secrets take effect immediately — no redeploy needed.

### Option B — Cloudflare Dashboard
Workers & Pages → **voxlink-api** → Settings → **Variables and Secrets** → add
each as a **Secret**.

### Option C — GitHub + CI
`deploy-backend.yml` auto-sets **`CF_CALLS_APP_SECRET`**, `TURN_KEY_ID`,
`TURN_KEY_TOKEN` from matching **GitHub repo secrets** on deploy.
⚠️ It does **NOT** set `CF_CALLS_APP_ID` — set that one manually (Option A/B).

---

## Architecture — why SFU (not P2P)

Voxcall is a **1:1 paid marketplace call** (user ↔ host). SFU is the right
production choice over peer-to-peer:

- **Reliable connectivity** — media flows through Cloudflare's edge; no fragile
  P2P NAT negotiation.
- **Privacy** — peers never see each other's IP (P2P would expose it).
- **Moderation / recording** — server-side media enables future recording for
  dispute/abuse handling and AI moderation (impossible with pure P2P).
- **Accurate billing** — the server knows a call is live (drives the heartbeat
  balance cap + cron reaper).
- **Future group calls** — SFU scales to 3+ participants.

P2P + TURN would be slightly cheaper / lower-latency for 2 parties, but loses
all of the above. **Keep SFU.**


---

## Production recommendations

- **Configure SFU + TURN both.** SFU alone won't connect on restrictive
  networks (mobile data / firewalls). In production the backend drops the
  public dev TURN relay and requires real Cloudflare TURN keys
  (`ENVIRONMENT = "production"` in `wrangler.toml`).
- **Audio-first.** SFU egress is billed per GB; audio is cheap, video costs
  more. Per-host audio/video rates already let you price video higher.
- **Region** — Cloudflare is global anycast; clients auto-connect to the
  nearest edge, no per-region setup.
- **Monitor egress** in the Cloudflare Realtime dashboard as call volume grows.
- **Keep secrets out of source** — App Secret / TURN token are real secrets;
  never commit them (only `CF_ACCOUNT_ID` / `CF_CALLS_APP_ID` are non-sensitive
  identifiers, but we still store them as Worker secrets).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "CF Calls not configured — contact admin…" | `CF_CALLS_APP_ID` / `CF_CALLS_APP_SECRET` missing on Worker | Set both (Option A/B) |
| Call starts but never connects (stuck "Connecting…") | TURN missing/invalid | Set `TURN_KEY_ID` + `TURN_KEY_TOKEN` |
| `CF Calls createSession error 401/403` | Wrong App Secret, or secret for a different app | Re-copy App Secret for the correct App ID |
| Works on Wi-Fi, fails on mobile data | No TURN relay | Configure Cloudflare TURN (above) |
| Calls connect but no audio/video | Mic/camera permission denied on client | Grant permissions (the app prompts) |

---

## Current state (in code)

- `api-server/src/lib/cf-calls.ts` — SFU client (sessions / pushTracks /
  pullTracks). Guarded by `createCFCalls` which errors clearly when unconfigured.
- `api-server/src/routes/call.ts` — initiate/answer/end; returns the
  "CF Calls not configured" error when `CF_CALLS_APP_ID`/`_SECRET` are absent.
- `GET /api/calls/ice-config` — serves STUN/TURN to clients; hardens to
  Cloudflare TURN in production.
- `voxlink/services/webrtc.ts` / `voxlink-host` — client SFU integration
  (ICE-restart, heartbeat, quality monitoring).

> The code is production-ready; enabling calls is purely about setting the
> Cloudflare Realtime credentials above on the `voxlink-api` Worker.
