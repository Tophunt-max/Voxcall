-- Migration: production-grade, price-tiered VIP plans
-- Refresh the seeded plans' perks so each clearly reflects its (escalating)
-- features, and add an entry-level Weekly Pass for price variety.

UPDATE vip_plans SET color = '#9CA3AF', badge = '⭐', perks =
  '["Silver VIP badge","5% off every call","100 signup bonus coins","20 free coins daily","2 free call minutes daily","Chat any host without calling first","Priority support"]'
  WHERE tier = 'silver';

UPDATE vip_plans SET color = '#F59E0B', badge = '👑', perks =
  '["Gold VIP badge","10% off every call","300 signup bonus coins","60 free coins daily","5 free call minutes daily","Chat any host without calling first","Priority matching (better hosts)","Priority support"]'
  WHERE tier = 'gold';

UPDATE vip_plans SET color = '#A855F7', badge = '💎', perks =
  '["Platinum VIP badge","20% off every call","800 signup bonus coins","150 free coins daily","10 free call minutes daily","Chat any host without calling first","Priority matching (best hosts)","Exclusive profile frame","24/7 priority support"]'
  WHERE tier = 'platinum';

-- Entry-level weekly plan (cheap, short, light perks) — an easy first step.
INSERT OR IGNORE INTO vip_plans
  (id, tier, name, price_coins, duration_days, call_discount_pct, daily_bonus_coins, signup_bonus_coins, daily_free_minutes, chat_unlock, badge, color, perks, is_active, sort_order)
VALUES
  ('vip_weekly', 'weekly', 'Weekly Pass', 299, 7, 3, 10, 30, 1, 1, '🎫', '#38BDF8',
   '["Weekly VIP badge","3% off every call","30 signup bonus coins","10 free coins daily","1 free call minute daily","Chat any host without calling first"]',
   1, 0);
