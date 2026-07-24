-- 0072_reward_task_seeds.sql
--
-- Seed default reward tasks for the new task types wired across the backend
-- (send_gifts, spend_on_gifts, send_messages, add_favorites, rate_calls,
-- video_calls, talk_minutes, coin_topup_count, subscribe_vip, complete_profile,
-- upload_avatar, login_streak) so a fresh install has a rich, working Tasks
-- page out of the box — spanning Monetization, Engagement, Social, Habit and
-- Onboarding.
--
-- Two of these intentionally demo the audience targeting (migration 0071):
--   • 'rt_vip_video_3'  → audience 'vip'  (free users see it locked 🔒 — upsell)
--   • 'rt_go_vip'       → audience 'free' (nudges non-VIP users to subscribe)
--
-- All INSERT OR IGNORE — never duplicates or overwrites admin-tuned tasks.

INSERT OR IGNORE INTO reward_tasks
  (id,                    code,                title,                  description,                                          icon,      category,   task_type,          target_count, coins_reward, cooldown_hours, sort_order, audience) VALUES
  -- Engagement
  ('rt_talk_30',          'talk_30_min',       'Talk 30 Minutes',      'Spend 30 minutes on calls today.',                   'call',    'daily',    'talk_minutes',      30,          80,           24,             300, 'all'),
  ('rt_send_msgs_20',     'send_20_messages',  'Send 20 Messages',     'Chat with hosts — send 20 messages today.',          'share',   'daily',    'send_messages',     20,          30,           24,             310, 'all'),
  ('rt_rate_3',           'rate_3_calls',      'Rate 3 Calls',         'Rate 3 of your calls today.',                        'video',   'daily',    'rate_calls',         3,          30,           24,             320, 'all'),
  ('rt_fav_3',            'add_3_favorites',   'Add 3 Favorites',      'Favorite 3 hosts you like today.',                   'invite',  'daily',    'add_favorites',      3,          40,           24,             330, 'all'),
  ('rt_vip_video_3',      'vip_video_3_calls', 'VIP: 3 Video Calls',   'Complete 3 video calls today for a big VIP bonus.',  'video',   'daily',    'video_calls',        3,          200,          24,             340, 'vip'),
  -- Monetization
  ('rt_send_gifts_3',     'send_3_gifts',      'Send 3 Gifts',         'Send 3 gifts to hosts today.',                       'gift',    'daily',    'send_gifts',         3,          60,           24,             350, 'all'),
  ('rt_first_recharge',   'first_recharge',    'First Recharge',       'Buy any coin pack for the first time.',              'coin',    'one_time', 'coin_topup_count',   1,          500,          0,              360, 'all'),
  ('rt_go_vip',           'go_vip',            'Go VIP',               'Subscribe to VIP and grab a welcome bonus.',         'gift',    'one_time', 'subscribe_vip',      1,          300,          0,              370, 'free'),
  -- Habit
  ('rt_login_streak_7',   'login_streak_7',    '7-Day Login Streak',   'Claim your daily streak 7 times.',                   'flame',   'ongoing',  'login_streak',       7,          200,          0,              380, 'all'),
  -- Onboarding
  ('rt_complete_profile', 'complete_profile',  'Complete Your Profile','Add your name & details to your profile.',           'gift',    'one_time', 'complete_profile',   1,          50,           0,              390, 'all'),
  ('rt_upload_avatar',    'upload_avatar',     'Add a Profile Photo',  'Upload a profile picture.',                          'gift',    'one_time', 'upload_avatar',      1,          20,           0,              400, 'all');
