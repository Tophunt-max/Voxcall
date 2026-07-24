# Cloudflare Queues — Decision Doc & Rollout Runbook

Should Voxcall move **bulk push notifications** (engagement campaigns) onto
Cloudflare Queues? This doc captures the pricing, the benefits, **when** it's
worth adopting, and the **exact rollout order** so enabling it never breaks the
GitHub Actions auto-deploy.

> TL;DR — Not urgent at today's scale (the cron already self-throttles). Adopt
> when the engagement audience grows into **tens of thousands** of active users.
> Cost is tiny (~$1–18/mo of usage); the only real gotcha is that the queue
> resource **must be created before** `wrangler.toml` references it.

---

## 1. Current state (what's already in place)

The bulk-push subrequest risk is **already mitigated without Queues**. A single
cron invocation is capped at ~1000 outbound subrequests, and the old campaigns
tried to send up to 5000 pushes in one tick.

Fix that shipped (see `api-server/src/index.ts`):

- `CAMPAIGN_MAX_PER_TICK = 300` — streak + near-level campaigns process a
  bounded slice per cron tick.
- Campaigns **exclude already-notified users** (`NOT EXISTS` on `notifications`
  by type + day), so they are **resumable**: the once-per-minute cron drains the
  full audience across the campaign hour, and no single invocation can exceed
  the subrequest budget.

This is enough for the current scale. Queues becomes worth it when the audience
is large enough that "spread across the hour" is no longer fast/reliable enough,
or when we want guaranteed delivery + automatic retries.

---

## 2. Pricing

Billing is per **operation** — one operation per 64 KB of data **written, read,
or deleted**, counted **per message** (not per batch). A typical delivered
message = **3 operations** (1 write + 1 read + 1 delete). Voxcall push messages
are tiny (a userId + notification type, far under 64 KB), so each is 1 op per
write/read/delete.

| | Workers Free | Workers Paid (`$5/mo` base) |
|---|---|---|
| Included | 10,000 operations/day | 1,000,000 operations/month, then **$0.40 / million** |
| Message retention | 24 hours (fixed) | 4 days default, up to 14 days |
| Egress / bandwidth charge | none | none |

Source: [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
(as of 2026-07; content rephrased for licensing compliance). Note: Queues became
available on the **Workers Free plan** in Feb 2026.

### Voxcall cost estimate

Monthly bill formula (Paid): `((messages × 3) − 1,000,000) ÷ 1,000,000 × $0.40`

| Scale | Pushes / month | Extra Queues cost |
|---|---|---|
| ~10k users (~1M pushes) | 1,000,000 | **~$0.80/mo** |
| ~50k users (~7.5M pushes) | 7,500,000 | **~$8.60/mo** |
| ~100k users (~15M pushes) | 15,000,000 | **~$17.60/mo** |

The **Free tier** (10k ops/day ≈ ~3,300 messages/day) only covers very small
volumes — real engagement campaigns need the Paid plan.

> **Note on plan:** Voxcall already runs Durable Objects (`ChatRoom`,
> `NOTIFICATION_HUB`, `PRESENCE_REGISTRY`). If those run on classic (non-SQLite)
> Durable Objects the account is **already on Workers Paid**, so the `$5` base is
> already covered and Queues only adds the per-operation usage above.

---

## 3. Benefits (Voxcall-specific)

1. **Removes the subrequest-limit problem permanently.** The cron just
   *enqueues* recipient IDs (a few ops); a separate **consumer** Worker delivers
   them in bounded batches. The cron invocation stays cheap regardless of
   audience size — no more per-tick send caps.
2. **Automatic retries + Dead Letter Queue (DLQ).** FCM 429/503 → the message
   is retried automatically; after max retries it lands in a DLQ instead of being
   silently dropped (today a failed push is lost).
3. **Spike smoothing.** Blasting 50k users at once is throttled by the consumer's
   `max_batch_size` / `max_concurrency`, so FCM rate limits and D1 aren't
   hammered simultaneously.
4. **Decouples send from the cron.** Any route or campaign can enqueue a push
   without blocking its response; delivery is reliable and asynchronous.

---

## 4. When to adopt

Adopt Queues when **any** of these is true:

- Active engagement audience is in the **tens of thousands** and campaigns no
  longer drain comfortably within their hour window.
- We need **guaranteed delivery / retries** for pushes (e.g. transactional
  nudges we can't afford to drop).
- We start doing large **admin broadcast** sends (bulk notifications to all
  users) that must fan out reliably.

Until then, the cursor-batched cron (Section 1) is sufficient.

---

## 5. Implementation plan

### 5a. Create the queue resources (ONE-TIME, before any code deploy)

Run these locally with an authenticated `wrangler` (Cloudflare account access).
**This must happen before** the `wrangler.toml` changes are deployed, otherwise
`wrangler deploy` in CI fails because the queue does not exist yet.

```bash
cd api-server
wrangler queues create voxlink-push
wrangler queues create voxlink-push-dlq   # dead-letter queue
```

### 5b. `wrangler.toml` — producer binding + consumer + DLQ

```toml
# Producer binding — lets the Worker enqueue push jobs.
[[queues.producers]]
binding = "PUSH_QUEUE"
queue   = "voxlink-push"

# Consumer — the same Worker receives batches to deliver.
[[queues.consumers]]
queue               = "voxlink-push"
max_batch_size      = 100     # messages per batch
max_batch_timeout   = 5       # seconds to wait to fill a batch
max_retries         = 3
max_concurrency     = 5       # parallel consumer invocations (throttle)
dead_letter_queue   = "voxlink-push-dlq"
```

### 5c. `types.ts` — add the binding

```ts
export interface Env {
  // ...existing...
  PUSH_QUEUE?: Queue<PushJob>;   // optional so local/dev without the queue still type-checks
}

export interface PushJob {
  userIds: string[];               // small batch of recipients
  title: string;
  body: string;
  data?: Record<string, string>;
  type: string;                    // notification type (for the notifications row)
}
```

### 5d. Producer — enqueue instead of sending inline

In the campaign crons (`maybeSendStreakReminders`, `maybeSendNearLevelNudges`,
and the engagement drips), replace the inline `sendFCMPush` / `notifyEngagement`
loop with an enqueue. Chunk recipients so each message carries ~100 IDs:

```ts
async function enqueuePush(env: Env, job: PushJob): Promise<boolean> {
  if (!env.PUSH_QUEUE) return false;           // graceful fallback → caller sends inline
  await env.PUSH_QUEUE.send(job);
  return true;
}
```

Keep the existing inline path as a **fallback** when `PUSH_QUEUE` is undefined,
so the code is safe to merge before the queue exists and in local dev.

### 5e. Consumer — deliver batches

Add a `queue` handler to the default export in `api-server/src/index.ts`:

```ts
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) { /* ...existing... */ },

  async queue(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const { userIds, title, body, data, type } = msg.body;
        const tokens = await getFCMTokens(env.DB, userIds);
        if (tokens.length) {
          await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, data, env.DB);
        }
        msg.ack();                 // success → remove from queue
      } catch (e) {
        console.warn('[queue] push delivery failed, will retry:', e);
        msg.retry();               // transient → retry (up to max_retries, then DLQ)
      }
    }
  },
};
```

---

## 6. Rollout order (critical — do NOT reorder)

1. **Create the queues** (`wrangler queues create ...`) — Section 5a.
2. Merge the **code** (producer + consumer + graceful `PUSH_QUEUE?` fallback).
   Safe even before step 3 because the binding is optional.
3. Add the **`wrangler.toml`** producer/consumer blocks and deploy.
   > ⚠️ If `wrangler.toml` references a queue that was **not** created in step 1,
   > `wrangler deploy` in the GitHub Action **fails**. Always create first.
4. Verify in the dashboard: **Workers & Pages → Queues** shows `voxlink-push`
   with messages flowing and near-zero DLQ.

## 7. Rollback

- Remove the `[[queues.consumers]]` / `[[queues.producers]]` blocks from
  `wrangler.toml` and deploy. With `PUSH_QUEUE` now undefined, the producer's
  graceful fallback sends inline again (Section 5d) — no code revert needed.
- The queues themselves can be left in place (empty queues cost nothing) or
  deleted with `wrangler queues delete voxlink-push`.

---

## 8. References

- [Cloudflare Queues — pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Queues — get started / consumers](https://developers.cloudflare.com/queues/)
- Related: `api-server/src/index.ts` (cron campaigns), `api-server/src/lib/fcm.ts`
  (`sendFCMPush`, `getFCMTokens`), `api-server/src/lib/engagementNotify.ts`.
