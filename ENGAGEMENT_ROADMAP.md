# Voxcall (VoxLink) — Engagement & Retention Roadmap

> Goal: turn first-time callers into daily, habitual users — and keep hosts
> earning so supply stays healthy. This document maps the **current state**,
> the **habit-forming strategy**, and a **prioritized list of algorithms** to
> build, all grounded in the actual codebase (`api-server/`).

---

## 1. Current State (verified against code)

### What already exists ✅

| Feature | Where | Notes |
|---|---|---|
| Host level system | `lib/levels.ts`, migration `0025` | Newcomer→Elite, `rank_boost` drives discovery order, level-up coin rewards, per-level earning share + rate caps. Auto level-up engine in `lib/levelService.ts`. |
| Daily login streak | `lib/streak.ts`, `GET/POST /api/user/streak[/claim]`, migration `0027` | IST-day based, 7-day rotating schedule + milestone bonuses. Admin-tunable. |
| First-call-free | `lib/billing.ts` (`chargeCallerWithFreePool`), migration `0028` | New users get N free call minutes; host is still paid (platform absorbs cost). |
| Referral | `referral_codes`/`referral_uses`, `/api/user/referral`, `auth.ts` | Anti-Sybil: coins credited only after OTP verify. |
| Random matchmaking | `routes/match.ts`, migration `0026` | Filters, no-repeat window, daily cap, decline cooldown. |
| Favorites | `user_favorites`, `/api/user/favorites` | Used as an affinity signal by the new recommender. |
| Push + in-app notifications | `lib/fcm.ts`, `NotificationHub` DO, `notifications` table | Transactional only (calls, chat, level-up, admin broadcasts). |

### Gaps this roadmap addresses ⚠️

1. **Discovery is identical for every user.** `GET /api/hosts` ranks purely by
   `is_online → rank_boost → rating → total_minutes`. No personalization,
   no affinity, no exploration for new hosts. → **Priority 1**.
2. **No automated re-engagement / win-back.** The cron (`* * * * *`) only reaps
   stale calls, recalcs levels, and refreshes FX. Inactive users are never
   nudged back. → **Priority 2**.
3. **Random match pick is uniform** (`OFFSET RANDOM`) — ignores host quality,
   acceptance rate, and caller affinity. → **Priority 3**.
4. **Rewards are predictable** (fixed streak schedule) → less dopamine than a
   variable reward. → **Priority 4**.
5. **No user-side gamification** (XP/levels/VIP for callers). → **Priority 5**.

---

## 2. Habit-Forming Strategy — the Hook Model

`Trigger → Action → Variable Reward → Investment`, applied to Voxcall:

### Trigger (bring them back)
- **Behavioral pushes** (Priority 2 cron): "🟢 {favorite host} is online now",
  "🔥 your {N}-day streak ends tonight — claim now" (loss aversion), "your
  bonus coins expire soon".
- **Timing:** send around each user's historical active window, not a fixed
  hour.

### Action (make it effortless)
- Surface **first-call-free** aggressively to new users.
- **1-tap Random Match** + a **"Recommended for you"** rail (Priority 1) on the
  home screen so there's always an obvious next call.

### Variable Reward (the dopamine engine)
- Make the daily reward **probabilistic** (scratch/spin within an admin-set
  expected value) instead of a fixed number (Priority 4).
- Occasional surprise perks: bonus-coin calls, "next call 50% off", lucky
  premium-host intro minute.

### Investment (sunk cost → retention)
- Streak days, favorites/follows, ratings given, call history, and a future
  **user XP/VIP tier** (Priority 5) all make the account more valuable the
  longer it's used.

### Social / FOMO layers
- Live "X hosts online now" counts, limited-time coin sales with countdowns,
  leaderboards for top callers / longest streaks.

---

## 3. Algorithms — Prioritized Build List

### 🥇 Priority 1 — Personalized Host Recommendation (SHIPPED in this change)
A per-user weighted scoring layer on top of the existing quality signals.

```
score(host | user) =
    w.online      * online_now
  + w.rating      * rating/5
  + w.rank_boost  * normalized_level_rank_boost
  + w.popularity  * log10(1+review_count)            (capped)
  + w.favorite    * is_favorite
  + w.past_calls  * affinity_from_call_history        (capped)
  + w.language    * language_overlap_fraction
  + w.specialty   * specialty_overlap_fraction
  + w.gender      * matches_preferred_gender
  + w.freshness   * new_host_coldstart_boost          (exploration)
  + w.exploration * random_jitter                     (epsilon-greedy)
```

- **Exploration vs exploitation:** `freshness` + `exploration` jitter give new
  hosts rotation/exposure (supply-side retention) instead of a rich-get-richer
  list. This is a lightweight stand-in for a multi-armed bandit.
- **Implementation:** `lib/recommend.ts` (pure, testable scoring) + new
  `GET /api/hosts/recommended` (authenticated). Weights + on/off flag live in
  `app_settings` (`reco_weights`, `reco_enabled`) so they're tunable without a
  deploy. Candidate pool is bounded (~80 hosts) so it stays cheap on D1.
- **Affinity inputs** derived per request: favorites, per-host call counts, and
  the user's preferred languages/specialties/gender inferred from who they've
  called before.
- Each result carries a human `reason` ("Favorite", "You've called before",
  "Speaks your language", "New host", "Top rated") for the UI.

### 🥈 Priority 2 — Re-engagement / Churn-prevention Cron (SHIPPED in this change)
A scheduled job that finds idle users and nudges them back.

- **Churn signal:** days since last call (`call_sessions` as caller), with
  `updated_at` as a fallback "last seen".
- **Buckets:** `idle` (≈3 days) → soft nudge / "favorite online" trigger;
  `winback` (≈7+ days) → stronger message highlighting free streak / bonus.
- **Personalization:** if the user has a **favorite host online right now**,
  the message names them ("🟢 {host} is online — say hi").
- **Safety:** feature flag (`reengagement_enabled`), per-user cooldown
  (`reengagement_cooldown_days`, dedup via prior `reengagement` notifications),
  per-run cap (`reengagement_max_per_run`), and an interval gate
  (`reengagement_interval_hours`) using the same slot-claim pattern as the
  level recalc / FX refresh jobs. Best-effort; never throws.
- **Delivery:** reuses `notifications` insert + `NotificationHub` realtime +
  `sendFCMPush`.

### 🥉 Priority 3 — Quality-weighted Random Matchmaking (planned)
Replace the uniform `OFFSET RANDOM` pick in `match.ts` with a weighted draw:
`weight = f(rating, acceptance_rate, caller_affinity, demand_balancing)`. Spread
demand so a few top hosts don't absorb everything and newer hosts still get
random calls. Keep all existing anti-abuse guards.

### Priority 4 — Variable Reward Engine (planned)
Turn the fixed daily-streak schedule into a probabilistic reward with an
admin-controlled expected value (the payout curve stays budget-neutral; only
the *presentation* becomes a spin/scratch). Add streak-freeze and targeted
"low balance / high churn-risk" discount offers.

### Priority 5 — User XP / VIP Tiers (planned)
Mirror the host level system for callers: XP from calls/minutes/spend → badges
and VIP tiers (priority matching, exclusive hosts, small discounts). Maximizes
"investment".

### Priority 6 — Collaborative Filtering (later, data-dependent)
Once call volume is sufficient: item-item similarity ("users who called this
host also called…") to feed the Priority 1 recommender as another signal.

---

## 4. Config Reference (new `app_settings` keys)

| Key | Default | Meaning |
|---|---|---|
| `reco_enabled` | `1` | Master switch for `/api/hosts/recommended`. |
| `reco_weights` | JSON | Scoring weights (see `lib/recommend.ts` `DEFAULT_WEIGHTS`). |
| `reengagement_enabled` | `1` | Master switch for the re-engagement cron. |
| `reengagement_idle_days` | `3` | Days of inactivity to count as "idle". |
| `reengagement_winback_days` | `7` | Threshold for the stronger win-back message. |
| `reengagement_cooldown_days` | `3` | Min gap between re-engagement pushes per user. |
| `reengagement_max_per_run` | `200` | Cap on users processed per cron run. |
| `reengagement_interval_hours` | `6` | Min hours between cron runs. |

All keys are tunable from the Admin panel (**Settings → Engagement —
Recommendations & Re-engagement**) and fall back to safe defaults when unset.

---

## 5. Suggested Sequencing

1. Ship & observe **Priority 1 + 2** (this change) — wire the
   "Recommended for you" rail in the user app to `GET /api/hosts/recommended`.
2. Tune `reco_weights` and the re-engagement thresholds from the admin panel
   using real engagement data.
3. Build **Priority 3 (weighted matchmaking)** and **Priority 4 (variable
   rewards)**.
4. Add **Priority 5 (user XP/VIP)**, then revisit **Priority 6** once data
   supports collaborative filtering.
