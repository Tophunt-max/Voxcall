# Cloudflare Queues — Implementation Guide (step-by-step)

A hands-on, copy-paste guide to move Voxcall's **bulk push notifications** onto
Cloudflare Queues. Follow the steps **in order**. For the *why / pricing / when*,
see [`CLOUDFLARE_QUEUES.md`](./CLOUDFLARE_QUEUES.md).

> **Golden rule:** create the queue resources FIRST (Step 1). If `wrangler.toml`
> references a queue that doesn't exist, `wrangler deploy` in CI fails.

All paths below are relative to `api-server/`.

---

## Prerequisites

- `wrangler` authenticated against the Cloudflare account (`wrangler login` or
  `CLOUDFLARE_API_TOKEN`).
- Workers Paid plan active (needed for real campaign volume — see pricing doc).
- Confirm the current push code you're replacing:
  - `src/lib/fcm.ts` → `sendFCMPush(serviceAccountJson, tokens, title, body, data?, db?)`
    and `getFCMTokens(db, userIds)`.
  - `src/index.ts` → campaign crons `maybeSendStreakReminders`,
    `maybeSendNearLevelNudges`, and the engagement drips.

---

## Step 1 — Create the queues (one-time)

```bash
cd api-server
wrangler queues create voxlink-push
wrangler queues create voxlink-push-dlq
```

Verify:

```bash
wrangler queues list
```

---

## Step 2 — `wrangler.toml` (producer + consumer + DLQ)

Add these blocks (near the existing `[[d1_databases]]` / `[durable_objects]`
sections):

```toml
# ── Push delivery queue ──────────────────────────────────────────────────────
# Producer binding: lets the Worker enqueue push jobs (env.PUSH_QUEUE.send).
[[queues.producers]]
binding = "PUSH_QUEUE"
queue   = "voxlink-push"

# Consumer: the SAME Worker receives batches to deliver via FCM.
[[queues.consumers]]
queue             = "voxlink-push"
max_batch_size    = 100   # up to 100 messages per consumer invocation
max_batch_timeout = 5     # or flush after 5s, whichever comes first
max_retries       = 3     # transient failures retried before DLQ
max_concurrency   = 5     # cap parallel consumer invocations (throttle FCM/D1)
dead_letter_queue = "voxlink-push-dlq"
```

> Do NOT commit/deploy this step until Step 1 is done on the account.

---

## Step 3 — `src/types.ts` (binding + job shape)

```ts
// Add to the Env interface. OPTIONAL (?) so local dev / pre-queue deploys still
// type-check and fall back to inline sending.
export interface Env {
  // ...existing fields...
  PUSH_QUEUE?: Queue<PushJob>;
}

// A single queued push job carries a SMALL batch of recipient user IDs plus the
// notification payload. The consumer resolves FCM tokens and sends.
export interface PushJob {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  type: string; // notification type (drives the in-app notifications row / channel)
}
```

---

## Step 4 — `src/lib/pushQueue.ts` (new file: enqueue + deliver helpers)

```ts
// ============================================================================
// Push-queue helpers. Producer enqueues small recipient batches; the consumer
// (src/index.ts `queue()`) calls deliverPushBatch to actually send via FCM.
// Everything is a graceful no-op fallback when PUSH_QUEUE is unbound so the
// code is safe to ship BEFORE the queue exists and in local dev.
// ============================================================================
import type { Env, PushJob } from '../types';
import { getFCMTokens, sendFCMPush } from './fcm';

const QUEUE_CHUNK = 100; // recipients per queued message

/**
 * Enqueue a push to many users, chunked. Returns true if enqueued, false if the
 * queue is unbound (caller should then send inline as a fallback).
 */
export async function enqueuePush(
  env: Env,
  userIds: string[],
  title: string,
  body: string,
  type: string,
  data?: Record<string, string>,
): Promise<boolean> {
  if (!env.PUSH_QUEUE) return false;
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return true;

  const jobs: PushJob[] = [];
  for (let i = 0; i < ids.length; i += QUEUE_CHUNK) {
    jobs.push({ userIds: ids.slice(i, i + QUEUE_CHUNK), title, body, data, type });
  }
  // sendBatch is cheaper than N sends; falls back to individual sends if needed.
  try {
    await env.PUSH_QUEUE.sendBatch(jobs.map((body) => ({ body })));
  } catch {
    await Promise.all(jobs.map((j) => env.PUSH_QUEUE!.send(j)));
  }
  return true;
}

/** Deliver one queued job (called by the consumer). Throws on transient error
 *  so the runtime retries the message. */
export async function deliverPushBatch(env: Env, job: PushJob): Promise<void> {
  const tokens = await getFCMTokens(env.DB, job.userIds);
  if (tokens.length === 0) return;
  await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, job.title, job.body, job.data, env.DB);
}
```

---

## Step 5 — `src/index.ts` (consumer handler)

Add a `queue` handler to the default export (alongside `fetch` and `scheduled`):

```ts
import { deliverPushBatch } from './lib/pushQueue';
import type { PushJob } from './types';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // ...existing cron body unchanged...
  },

  // Push delivery consumer. Each message = one recipient batch.
  async queue(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await deliverPushBatch(env, msg.body);
        msg.ack();                 // success → remove from queue
      } catch (e) {
        console.warn('[queue] push delivery failed; retrying:', e);
        msg.retry();               // transient → retry (then DLQ after max_retries)
      }
    }
  },
};
```

---

## Step 6 — Producers: enqueue instead of sending inline

Convert the heavy campaigns to enqueue. Keep the **inline path as a fallback**
so nothing breaks before the queue is live.

### Example: `maybeSendStreakReminders`

Replace the FCM-send loop (the `for (let i = 0; i < ids.length; i += 100)` block
that calls `getFCMTokens` + `sendFCMPush`) with:

```ts
// Enqueue instead of blasting FCM inline. Falls back to the existing inline
// batched send when the queue isn't bound yet.
const enqueued = await enqueuePush(env, ids, title, body, 'streak_reminder');
if (!enqueued) {
  // ── fallback: existing inline path (unchanged) ──
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    for (let i = 0; i < ids.length; i += 100) {
      const tokens = await getFCMTokens(env.DB, ids.slice(i, i + 100));
      if (tokens.length) {
        await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, { type: 'streak_reminder' }, env.DB);
      }
    }
  }
}
```

Add the import at the top of `index.ts`:

```ts
import { enqueuePush } from './lib/pushQueue';
```

### Once the queue is live: relax the per-tick cap

Because the consumer now absorbs the fan-out, the cron no longer needs to be
throttled per tick. You can raise/remove `CAMPAIGN_MAX_PER_TICK` and drop the
`NOT EXISTS`-based resumability if you prefer a single enqueue per day. Do this
**only after** verifying the consumer is healthy (Step 8).

### Engagement drips (`notifyEngagement`) — optional

The drips (`maybeRunOnboardingDrip`, `maybeSendWeeklyRecap`, etc.) call
`notifyEngagement`, which applies quiet-hours / daily-cap / opt-out rails per
user AND writes the in-app notification row. To move these to the queue, enqueue
the recipient IDs and run the SAME rails inside `deliverPushBatch` (import and
call `notifyEngagement` there instead of raw `sendFCMPush`). Keep the rails —
don't bypass them.

---

## Step 7 — Local test

```bash
wrangler dev
```

- Trigger a campaign path (or temporarily call `enqueuePush` from a test route).
- In local dev, the consumer runs in the same process — watch the logs for
  `[queue] push delivery` lines.
- Confirm the fallback: with the `[[queues.*]]` blocks removed, `env.PUSH_QUEUE`
  is undefined and `enqueuePush` returns false → inline send runs.

---

## Step 8 — Deploy & verify (rollout order)

1. ✅ Step 1 done (queues exist on the account).
2. Merge code (Steps 3–6). Safe pre-queue: `PUSH_QUEUE?` is optional → fallback.
3. Add Step 2 (`wrangler.toml`) and deploy:
   ```bash
   wrangler deploy
   ```
4. Verify in the dashboard → **Workers & Pages → Queues → voxlink-push**:
   - Messages **Enqueued** climbs during a campaign.
   - **Consumed** tracks it; **Backlog** drains.
   - `voxlink-push-dlq` stays at ~0 (DLQ growth = delivery bug — inspect).
5. Optional: `wrangler tail` to watch consumer logs live.

---

## Step 9 — Rollback

- Remove the `[[queues.producers]]` + `[[queues.consumers]]` blocks from
  `wrangler.toml` and redeploy. `PUSH_QUEUE` becomes undefined → `enqueuePush`
  returns false → inline sending resumes automatically. **No code revert needed.**
- Empty queues cost nothing; delete only if desired:
  ```bash
  wrangler queues delete voxlink-push
  wrangler queues delete voxlink-push-dlq
  ```

---

## Checklist

- [ ] `wrangler queues create voxlink-push` + `voxlink-push-dlq`
- [ ] `types.ts`: `PUSH_QUEUE?` binding + `PushJob`
- [ ] `lib/pushQueue.ts`: `enqueuePush` + `deliverPushBatch`
- [ ] `index.ts`: `queue()` consumer handler
- [ ] Campaigns enqueue with inline fallback
- [ ] `wrangler.toml`: producer + consumer + DLQ (AFTER queues exist)
- [ ] `npm run typecheck && npm run lint && npm test`
- [ ] Deploy + verify enqueued/consumed/backlog + empty DLQ
- [ ] (Later) relax `CAMPAIGN_MAX_PER_TICK` once consumer is proven healthy

---

## References

- [Cloudflare Queues — get started](https://developers.cloudflare.com/queues/get-started/)
- [Queues — consumer configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Queues — pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- Decision doc: [`CLOUDFLARE_QUEUES.md`](./CLOUDFLARE_QUEUES.md)
