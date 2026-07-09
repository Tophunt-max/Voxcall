# Rewards System — Production-Grade Spec

This document captures what a **production-grade rewards system** should
include for a coin-based calling / social app like Voxcall, and calls out the
**dopamine-loop mechanics** that keep users returning. Treat this as the
north-star architecture; new work should map back to one of these buckets.

---

## Why rewards exist

Rewards are **not** a giveaway. They are a controlled economic instrument to:

1. **Increase D1/D7/D30 retention** — give users a reason to open the app
   tomorrow even when they didn't originally plan to.
2. **Reduce first-call friction** — coins earned on-app subsidise the first
   paid session, converting free users to callers.
3. **Amplify word-of-mouth** — referral rewards outperform paid marketing on
   voice/social apps because trust transfers with the referral.
4. **Smooth revenue** — variable rewards let us surge coin supply during weak
   demand windows (weekend campaigns, off-peak hours) without permanent
   discounts.

Every mechanic below either **increases habit strength** (streaks, spin) or
**captures marginal LTV** (coupons, campaigns).

---

## The Dopamine Loop

The habit loop is: **Cue → Craving → Response → Reward**.
Production apps stack four reinforcement patterns on top of it:

| Pattern | What it does | Example in our app |
|---|---|---|
| **Variable reward** | The brain releases the largest dopamine spike when the reward is *uncertain*. Slot machines exploit exactly this. | **Lucky Spin Wheel** — user gets 1 free spin/day; the payout ranges from 5 → 1000 coins with weighted probabilities. |
| **Loss aversion (streak)** | Losing something already earned hurts ~2× more than gaining an equivalent amount. | **Daily streak** — day 1: 10c, day 2: 20c, day 7: 100c. Miss a day and the streak resets. Streak insurance can be sold for coins. |
| **Progress + completion** | Filling a bar is deeply satisfying (Zeigarnik effect). | **Task progress bars** on the Rewards page — 3/10 calls, 47/50 friends invited. |
| **Scarcity / FOMO** | Time-limited offers push urgent action. | **Time-limited campaigns** — "Double coins weekend, ends in 3h 42m", banner on every reward-earning surface. |

Bonus: **Social proof** ("1,247 users claimed today") and **anchoring**
(showing a "500 coin" tier alongside "50 coin" tiers) further shape choice.

---

## Feature Inventory

### A. Core reward tasks *(already shipped)*
- ✅ `reward_tasks` + `user_reward_progress` (migration 0043)
- ✅ Task types: `daily_checkin`, `complete_calls`, `spend_coins`,
  `refer_friend`, `watch_ad`, `share_app`
- ✅ Progress bumped on call end + referral verification
- ✅ `POST /api/user/rewards/claim` with atomic coin credit + ledger row

### B. Lucky Spin Wheel *(migration 0044)*
Variable reward — the strongest single dopamine driver on the page.

- `reward_spin_config` — admin-editable JSON of wheel segments
  (label / coins / weight / colour / emoji).
- `user_spin_state` — free spins remaining, earned spins remaining, last
  daily reset (UTC), lifetime stats.
- `reward_spin_history` — every spin (audit trail).
- Weighted-random selection is **server-side** — never trust the client.
- Free spins reset once per UTC day; earned spins never expire.
- Admin can grant extra spins by making tasks `award_spin_bonus`.

### C. Time-limited Campaigns *(migration 0044)*
FOMO layer applied on top of every existing reward flow.

- `reward_campaigns` — starts_at / ends_at / multiplier / applies_to_task_types.
- Claim path applies `multiplier` to `coins_reward` when an active campaign
  matches the task type (or applies-to-all).
- User page renders a live countdown banner with the multiplier.
- Non-overlapping campaigns picked deterministically by `created_at DESC`.

### D. Coupon Codes *(migration 0044)*
Marketing lever — sales team can drop codes on socials / partners.

- `reward_coupons` — code / coins_reward / max_uses / per_user_limit /
  expires_at.
- `user_coupon_redemptions` — dedupe key per (user, coupon).
- Redeem endpoint enforces per-user limit, global max_uses, expiry, active.
- Admin bulk-generates codes with a prefix and count.

### E. Achievements (silent milestones) *(migration 0044)*
Long-term reinforcement — small dopamine hit even without daily activity.

- `reward_achievements` — trigger_type + trigger_threshold + coins_reward.
- `user_achievements` — unlocked_at.
- Triggered from the same hook (`bumpRewardProgress`) — after progress
  update, the helper checks whether any threshold crossed and credits coins.
- Tiers: bronze / silver / gold / platinum for badge visuals.

### F. Budget cap *(migration 0044)*
Production safety — protect against runaway payouts + bugs.

- `reward_budget_daily` — coins_paid per UTC day (upsert).
- App setting `reward_daily_budget_cap` — 0 = unlimited.
- Every claim / spin / coupon / achievement checks + increments this counter
  in the same batch as the coin credit. When cap is hit, the endpoint
  returns 429 with a friendly message.

### G. Server-side push nudges
- After `bumpRewardProgress` credits progress, check whether the task just
  became claimable. If yes, enqueue an FCM push:
  *"You're one step closer! Claim your +100 coins now."*
- Rate-limited (max 1 push per user per task per 24h).
- Kill switch: `reward_push_nudges_enabled` app setting.

### H. Celebration polish
- Confetti + haptic on claim (client)
- Wheel deceleration animation with sound (optional, respects mute)
- Toast: `+50 coins!` with coin-flip icon

### I. Admin controls
Full CRUD across every entity:

- **Reward Tasks** (✅ shipped) — list / create / edit / toggle / delete +
  per-task claim + coins-paid stats.
- **Reward Campaigns** (new) — list / create / edit / delete + live
  active-now indicator + preview of what tasks are affected.
- **Reward Coupons** (new) — list / create (single or bulk) / edit / delete +
  usage bar + copy-code button.
- **Achievements** (new) — list / create / edit / toggle / delete + per-tier
  color badges.
- **Lucky Spin config** (new) — segments editor (drag to reorder, weight
  bars, live preview of the wheel).
- **Global reward controls** (new admin/settings page section) — daily
  budget cap, feature flags for spin / campaigns / coupons / achievements /
  push nudges.
- **Analytics** (roadmap) — DAU-in-rewards, coins paid vs revenue lift,
  campaign attribution, spin outcome distribution.

---

## Rate limits / abuse protection

- `POST /api/user/rewards/claim` — 20/min per user (already enforced).
- `POST /api/user/rewards/spin` — 30/min per user.
- `POST /api/user/rewards/redeem-coupon` — 10/min per user; global 100/min per code.
- Budget cap prevents unlimited payouts even if all other guards fail.
- Every award goes through **the same atomic batch**: UPDATE users.coins +
  UPSERT progress/state + INSERT coin_transactions (type='bonus') + UPSERT
  reward_budget_daily. If any statement fails the whole batch rolls back.

---

## Roadmap (not shipped this iteration, but next)

- **Streak escalation UI** — 7-day calendar with fire icon on maintained days.
- **Streak insurance** — spend 100 coins to save an at-risk streak.
- **Achievements gallery** — dedicated page + share-to-social.
- **Leaderboards** — top spenders / top talkers weekly, opt-in only.
- **Milestone chains** — task B unlocks after A is claimed.
- **Referral tiers** — bigger reward for 5th, 10th, 25th referral.
- **VIP tiers** — bronze/silver/gold with escalating base rewards.
- **A/B testing** — assign users to variants of `coins_reward` and
  measure downstream call revenue.
- **Coupon self-service** — deep-link coupons through campaigns.

---

## Data / privacy notes

- Every reward event has an audit trail row in `coin_transactions` (ledger)
  and in the reward-specific table (spin_history / user_coupon_redemptions /
  user_achievements). This double-write is intentional: the ledger is the
  source of truth for the coin balance; the reward tables carry the
  behavioural signal that finance may want to strip during data export.
- No PII lives in reward tables — only user_id foreign keys.
- Admins can hard-delete a coupon or achievement; the corresponding
  user rows are cleaned up in the same batch.
