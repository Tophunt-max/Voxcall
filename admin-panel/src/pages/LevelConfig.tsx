import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Trophy, Save, RefreshCw, Info, ChevronRight, Coins, Plus, Trash2 } from 'lucide-react';

interface LevelPerks {
  max_rate: number; // legacy combined cap (kept for back-compat = max of audio/video)
  max_audio_rate: number;
  max_video_rate: number;
  /** Coins/min charged on a random AUDIO match against a host at this level. */
  random_audio_rate: number;
  /** Coins/min charged on a random VIDEO match against a host at this level. */
  random_video_rate: number;
  earning_share: number; // fraction 0–1 (platform keeps the rest)
  rank_boost: number;
}

interface LevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  min_calls: number;
  min_rating: number;
  min_minutes: number;
  min_earnings: number;
  coin_reward: number;
  description: string;
  perks: LevelPerks;
}

const DEFAULT_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0,   min_minutes: 0,    min_earnings: 0,     coin_reward: 0,    description: 'New to the platform', perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 0 } },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, min_minutes: 50,   min_earnings: 500,   coin_reward: 100,  description: 'Getting established',  perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 1 } },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, min_minutes: 300,  min_earnings: 3000,  coin_reward: 300,  description: 'Proven expertise',    perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.72, rank_boost: 2 } },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, min_minutes: 1000, min_earnings: 15000, coin_reward: 500,  description: 'Professional tier',   perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.75, rank_boost: 3 } },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, min_minutes: 2500, min_earnings: 50000, coin_reward: 1000, description: 'Top performer',       perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 } },
];

/**
 * Headroom (coins/min) the host app grants on top of the admin-set per-level
 * cap. Mirrors HOST_RATE_BONUS in api-server/src/lib/levels.ts so the admin UI
 * can show the host "effective max" they will actually be allowed to charge.
 */
const HOST_RATE_BONUS = 5;

/**
 * Bounds on the configurable ladder. Mirrors MIN_LEVELS / MAX_LEVELS in
 * api-server/src/lib/levels.ts — keep these in sync.
 */
const MIN_LEVELS = 1;
const MAX_LEVELS = 20;

/**
 * Build a sensible default LevelDef for a brand-new rung being appended in
 * the admin UI. Mirrors the server-side `generateLevelDefault` helper —
 * thresholds and rewards scale linearly off the last seeded rung so a freshly
 * added tier is always "harder" than the one before it. Admins can edit any
 * field after creation.
 */
function generateNewLevelDefaults(level: number): LevelDef {
  const base = DEFAULT_CONFIG[DEFAULT_CONFIG.length - 1];
  const overflow = Math.max(0, level - DEFAULT_CONFIG.length);
  const min_calls = base.min_calls + overflow * 1000;
  const min_rating = Math.min(5, base.min_rating + overflow * 0.05);
  const min_minutes = base.min_minutes + overflow * 2500;
  const min_earnings = base.min_earnings + overflow * 50000;
  const coin_reward = base.coin_reward + overflow * 500;
  const earning_share = Math.min(0.95, base.perks.earning_share + overflow * 0.02);
  // Random rates climb so a freshly added top tier isn't accidentally
  // cheaper than the previous one (matches the server-side default).
  const random_audio_rate = Math.min(500, base.perks.random_audio_rate + overflow * 10);
  const random_video_rate = Math.min(500, base.perks.random_video_rate + overflow * 15);
  return {
    level,
    name: `Tier ${level}`,
    badge: '🏆',
    color: base.color,
    min_calls,
    min_rating,
    min_minutes,
    min_earnings,
    coin_reward,
    description: 'Custom tier — edit name, badge, perks below',
    perks: {
      max_rate: 500,
      max_audio_rate: 500,
      max_video_rate: 500,
      random_audio_rate,
      random_video_rate,
      earning_share,
      rank_boost: base.perks.rank_boost + overflow,
    },
  };
}

function Field({ label, value, onChange, type = 'text', min, max, step, readOnly }: {
  label: string; value: string | number; onChange?: (v: string) => void;
  type?: string; min?: number; max?: number; step?: number; readOnly?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        min={min} max={max} step={step}
        readOnly={readOnly}
        className={`w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all ${readOnly ? 'opacity-60 cursor-default' : ''}`}
      />
    </div>
  );
}

export default function LevelConfig() {
  const [config, setConfig] = useState<LevelDef[]>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    api.getLevelConfig()
      .then(data => {
        if (Array.isArray(data) && data.length >= MIN_LEVELS && data.length <= MAX_LEVELS) {
          // Backfill perks defensively so the editor never reads undefined,
          // even if an older saved config predates the perks field. Older
          // saved configs only had `max_rate` — we mirror it into the new
          // channel-specific fields so admins see consistent values.
          //
          // For slots covered by DEFAULT_CONFIG (the seeded 5 rungs) we use
          // those values as the fallback; for slots beyond that (admins
          // having added custom rungs) we synthesize a fallback via
          // generateNewLevelDefaults so the form is always populated.
          setConfig(data.map((l: any, i: number) => {
            const fallback = DEFAULT_CONFIG[i] ?? generateNewLevelDefaults(i + 1);
            const savedPerks = l?.perks || {};
            const legacyMax = Number(savedPerks.max_rate) || fallback.perks.max_rate;
            const audio = Number(savedPerks.max_audio_rate) || legacyMax;
            const video = Number(savedPerks.max_video_rate) || legacyMax;
            // Random rates: fall back to seeded defaults for older saved
            // configs that pre-date these fields (no migration needed).
            const randomAudio = Number(savedPerks.random_audio_rate) || fallback.perks.random_audio_rate;
            const randomVideo = Number(savedPerks.random_video_rate) || fallback.perks.random_video_rate;
            return {
              ...fallback,
              ...l,
              // Always renumber `level` to position so add/remove ops on
              // the server side can never produce gaps.
              level: i + 1,
              perks: {
                ...fallback.perks,
                ...savedPerks,
                max_audio_rate: audio,
                max_video_rate: video,
                max_rate: Math.max(audio, video),
                random_audio_rate: randomAudio,
                random_video_rate: randomVideo,
              },
            };
          }));
        }
      })
      .catch(() => toast.error('Failed to load level config'))
      .finally(() => setLoading(false));
  }, []);

  const updateLevel = (idx: number, field: keyof LevelDef, val: string) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'min_calls' || field === 'coin_reward' || field === 'min_minutes' || field === 'min_earnings') return { ...l, [field]: Math.max(0, parseInt(val) || 0) };
      if (field === 'min_rating') return { ...l, [field]: Math.min(5, Math.max(0, parseFloat(val) || 0)) };
      return { ...l, [field]: val };
    }));
  };

  // Perks are nested; earning_share is edited as a percentage (10–95) but
  // stored as a fraction (0.10–0.95) to match the backend schema.
  // max_audio_rate / max_video_rate are admin-set per-channel ceilings; the
  // legacy `max_rate` field is kept in sync (= max of audio/video) for any
  // older reader still expecting the combined cap.
  const updatePerk = (idx: number, field: keyof LevelPerks, val: string) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const perks = { ...l.perks };
      if (field === 'max_audio_rate') {
        perks.max_audio_rate = Math.min(500, Math.max(1, parseInt(val) || 1));
        perks.max_rate = Math.max(perks.max_audio_rate, perks.max_video_rate);
      } else if (field === 'max_video_rate') {
        perks.max_video_rate = Math.min(500, Math.max(1, parseInt(val) || 1));
        perks.max_rate = Math.max(perks.max_audio_rate, perks.max_video_rate);
      } else if (field === 'max_rate') {
        // Legacy combined field — keep editable for completeness, but also
        // mirror into both channel caps so older clients see a sane value.
        const m = Math.min(500, Math.max(1, parseInt(val) || 1));
        perks.max_rate = m;
        perks.max_audio_rate = m;
        perks.max_video_rate = m;
      } else if (field === 'rank_boost') perks.rank_boost = Math.max(0, parseInt(val) || 0);
      else if (field === 'random_audio_rate') {
        perks.random_audio_rate = Math.min(500, Math.max(1, parseInt(val) || 1));
      } else if (field === 'random_video_rate') {
        perks.random_video_rate = Math.min(500, Math.max(1, parseInt(val) || 1));
      } else if (field === 'earning_share') {
        const pct = Math.min(95, Math.max(10, parseFloat(val) || 0));
        perks.earning_share = Math.round(pct) / 100;
      }
      return { ...l, perks };
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateLevelConfig(config);
      toast.success('Level config saved successfully!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Append a new rung to the end of the ladder. Caps at MAX_LEVELS so the
  // backend (which mirrors the same cap) never sees an over-long payload.
  const handleAddLevel = () => {
    setConfig(prev => {
      if (prev.length >= MAX_LEVELS) {
        toast.error(`Maximum ${MAX_LEVELS} levels allowed.`);
        return prev;
      }
      const next = generateNewLevelDefaults(prev.length + 1);
      return [...prev, next];
    });
  };

  // Remove a rung. Refuses to drop below MIN_LEVELS and refuses to delete
  // level 1 specifically (it's the floor every new host begins at and several
  // backend code paths assume it always exists). After removal, every
  // remaining rung is renumbered so `level` always equals position.
  const handleRemoveLevel = (idx: number) => {
    setConfig(prev => {
      if (prev.length <= MIN_LEVELS) {
        toast.error(`At least ${MIN_LEVELS} level is required.`);
        return prev;
      }
      if (idx === 0) {
        toast.error('Level 1 is the starting level and cannot be removed.');
        return prev;
      }
      return prev
        .filter((_, i) => i !== idx)
        .map((l, i) => ({ ...l, level: i + 1 }));
    });
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await api.recalculateHostLevels();
      toast.success(`All host levels recalculated using current thresholds!`);
    } catch (e: any) {
      toast.error(e.message || 'Recalculation failed');
    } finally {
      setRecalculating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Toast */}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy size={20} className="text-violet-500" /> Level System Configuration
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure thresholds, coin rewards, and badges for each host level. Changes apply on next recalculation.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-secondary text-foreground text-sm font-medium transition-all disabled:opacity-60"
          >
            <RefreshCw size={15} className={recalculating ? 'animate-spin' : ''} />
            {recalculating ? 'Recalculating...' : 'Recalculate All Host Levels'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl gradient-purple text-white text-sm font-semibold shadow-md hover:opacity-90 transition-all disabled:opacity-60"
          >
            <Save size={15} />
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 rounded-xl text-sm">
        <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="text-blue-700 dark:text-blue-300">
          <strong>How levels work:</strong> Hosts are <strong>auto-promoted in real time</strong> when they meet ALL of a level's thresholds — rated calls, rating, talk-time (minutes) &amp; total coins earned (calls + tips + chat) — the one-time Coin Reward is credited automatically.
          Level 1 is the starting level (no requirements). <strong>Perks</strong> per level: <strong>Max Audio Rate</strong> and <strong>Max Video Rate</strong> (highest coins/min a host may charge for each call type), <strong>Earning Share</strong> (host's cut of each call), and <strong>Rank Boost</strong> (higher = shown earlier in listings &amp; matchmaking).
          A host can charge up to <strong>+{HOST_RATE_BONUS} coins/min</strong> above each cap (effective ceiling shown next to each input).
          You can <strong>add or remove levels</strong> ({MIN_LEVELS}–{MAX_LEVELS} total) using the controls below; level 1 cannot be removed.
          Use <strong>"Recalculate All Host Levels"</strong> to back-fill existing hosts after changing thresholds.
        </div>
      </div>

      {/* Level preview row */}
      <div className="flex gap-3 flex-wrap">
        {config.map((lvl) => (
          <div
            key={lvl.level}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-white shadow-md"
            style={{ backgroundColor: lvl.color }}
          >
            <span>{lvl.badge}</span>
            <span>Lv.{lvl.level} {lvl.name}</span>
          </div>
        ))}
      </div>

      {/* Level cards */}
      <div className="space-y-4">
        {config.map((lvl, idx) => (
          <div
            key={lvl.level}
            className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
          >
            {/* Card header */}
            <div
              className="flex items-center gap-4 px-5 py-4"
              style={{ background: `linear-gradient(135deg, ${lvl.color}22, ${lvl.color}08)`, borderBottom: `2px solid ${lvl.color}40` }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold shadow-md"
                style={{ backgroundColor: lvl.color + '30', border: `2px solid ${lvl.color}60` }}
              >
                {lvl.badge}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground text-base">Level {lvl.level}</span>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: lvl.color }}
                  >
                    {lvl.name}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{lvl.description || '—'}</p>
              </div>
              {/* Coin reward badge */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
                <Coins size={14} className="text-amber-500" />
                <span className="text-sm font-bold text-amber-700 dark:text-amber-400">+{lvl.coin_reward} coins</span>
              </div>
              {/* Earning share badge */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">earns</span>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{Math.round(lvl.perks.earning_share * 100)}%</span>
              </div>
              {/* Remove level — disabled for level 1 (the floor every new
                  host begins at) and when only the minimum number of levels
                  remains. */}
              <button
                type="button"
                onClick={() => handleRemoveLevel(idx)}
                disabled={idx === 0 || config.length <= MIN_LEVELS}
                title={
                  idx === 0
                    ? 'Level 1 is the starting level and cannot be removed'
                    : config.length <= MIN_LEVELS
                      ? `At least ${MIN_LEVELS} level is required`
                      : `Remove level ${lvl.level}`
                }
                className="p-2 rounded-lg border border-border bg-card hover:bg-red-50 dark:hover:bg-red-950/30 hover:border-red-300 dark:hover:border-red-800 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-all disabled:opacity-40 disabled:hover:bg-card disabled:hover:text-muted-foreground disabled:hover:border-border disabled:cursor-not-allowed"
                aria-label={`Remove level ${lvl.level}`}
              >
                <Trash2 size={15} />
              </button>
            </div>

            {/* Fields grid */}
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              <Field label="Level #" value={lvl.level} readOnly />
              <Field
                label="Badge Emoji"
                value={lvl.badge}
                onChange={v => updateLevel(idx, 'badge', v)}
              />
              <Field
                label="Level Name"
                value={lvl.name}
                onChange={v => updateLevel(idx, 'name', v)}
              />
              <Field
                label="Color (hex)"
                value={lvl.color}
                onChange={v => updateLevel(idx, 'color', v)}
              />
              <Field
                label="Min Calls"
                value={lvl.min_calls}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'min_calls', v)}
              />
              <Field
                label="Min Rating (0–5)"
                value={lvl.min_rating}
                type="number"
                min={0}
                max={5}
                step={0.1}
                onChange={v => updateLevel(idx, 'min_rating', v)}
              />
              <Field
                label="Min Talk-time (min)"
                value={lvl.min_minutes}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'min_minutes', v)}
              />
              <Field
                label="Min Earnings (coins)"
                value={lvl.min_earnings}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'min_earnings', v)}
              />
              <Field
                label="Coin Reward"
                value={lvl.coin_reward}
                type="number"
                min={0}
                onChange={v => updateLevel(idx, 'coin_reward', v)}
              />
            </div>

            {/* Perks / benefits grid */}
            <div className="px-5 pt-1">
              <label className="block text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Perks / Benefits unlocked at this level
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Field
                    label="Max Audio Rate (coins/min)"
                    value={lvl.perks.max_audio_rate}
                    type="number"
                    min={1}
                    max={500}
                    onChange={v => updatePerk(idx, 'max_audio_rate', v)}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Host can set up to <strong>{Math.min(500, lvl.perks.max_audio_rate + HOST_RATE_BONUS)}</strong> (cap +{HOST_RATE_BONUS}).
                  </p>
                </div>
                <div>
                  <Field
                    label="Max Video Rate (coins/min)"
                    value={lvl.perks.max_video_rate}
                    type="number"
                    min={1}
                    max={500}
                    onChange={v => updatePerk(idx, 'max_video_rate', v)}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Host can set up to <strong>{Math.min(500, lvl.perks.max_video_rate + HOST_RATE_BONUS)}</strong> (cap +{HOST_RATE_BONUS}).
                  </p>
                </div>
                <Field
                  label="Earning Share %"
                  value={Math.round(lvl.perks.earning_share * 100)}
                  type="number"
                  min={10}
                  max={95}
                  onChange={v => updatePerk(idx, 'earning_share', v)}
                />
                <Field
                  label="Rank Boost"
                  value={lvl.perks.rank_boost}
                  type="number"
                  min={0}
                  onChange={v => updatePerk(idx, 'rank_boost', v)}
                />
              </div>
            </div>

            {/* Random call rates per level — applied when a caller hits
                /match/find and is matched to a host at this level. Lets
                admins reward higher-level hosts with a richer per-minute
                random rate instead of the historical flat fallback. */}
            <div className="px-5 pt-3">
              <label className="block text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Random call rates (charged on /match/find)
              </label>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Random Audio Rate (coins/min)"
                  value={lvl.perks.random_audio_rate}
                  type="number"
                  min={1}
                  max={500}
                  onChange={v => updatePerk(idx, 'random_audio_rate', v)}
                />
                <Field
                  label="Random Video Rate (coins/min)"
                  value={lvl.perks.random_video_rate}
                  type="number"
                  min={1}
                  max={500}
                  onChange={v => updatePerk(idx, 'random_video_rate', v)}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Falls back to the global Settings → Random Call Rates if blank or invalid. Higher levels typically charge more.
              </p>
            </div>

            {/* Description row */}
            <div className="px-5 pb-5">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <input
                type="text"
                value={lvl.description}
                onChange={e => updateLevel(idx, 'description', e.target.value)}
                placeholder="Short description of this level..."
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
              />
            </div>

            {/* Requirements summary */}
            {idx > 0 && (
              <div
                className="px-5 pb-4 flex items-center gap-2 text-xs text-muted-foreground"
              >
                <ChevronRight size={13} />
                <span>
                  Requires: <strong>{lvl.min_calls}+ calls</strong>, <strong>{lvl.min_rating}+ rating</strong>, <strong>{lvl.min_minutes}+ min talk-time</strong> and <strong>{lvl.min_earnings.toLocaleString()}+ coins earned</strong> to unlock
                  {lvl.coin_reward > 0 && <> · Reward: <strong className="text-amber-600">{lvl.coin_reward} coins</strong></>}
                  {' '}· Perks: <strong className="text-emerald-600">{Math.round(lvl.perks.earning_share * 100)}% earnings</strong>, audio up to <strong>{lvl.perks.max_audio_rate}/min</strong>, video up to <strong>{lvl.perks.max_video_rate}/min</strong>, random <strong className="text-violet-600">{lvl.perks.random_audio_rate}/{lvl.perks.random_video_rate}</strong>, rank +{lvl.perks.rank_boost}
                </span>
              </div>
            )}
            {idx === 0 && (
              <div className="px-5 pb-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ChevronRight size={13} />
                <span>Starting level — all new hosts begin here, no requirements · Perks: <strong className="text-emerald-600">{Math.round(lvl.perks.earning_share * 100)}% earnings</strong>, audio up to <strong>{lvl.perks.max_audio_rate}/min</strong>, video up to <strong>{lvl.perks.max_video_rate}/min</strong>, random <strong className="text-violet-600">{lvl.perks.random_audio_rate}/{lvl.perks.random_video_rate}</strong>, rank +{lvl.perks.rank_boost}</span>
              </div>
            )}
          </div>
        ))}

        {/* Add level — dashed-outline card lives at the end of the ladder.
            Disabled when the ladder is at MAX_LEVELS so we can never POST a
            payload the backend would reject. */}
        <button
          type="button"
          onClick={handleAddLevel}
          disabled={config.length >= MAX_LEVELS}
          className="w-full flex items-center justify-center gap-2 px-5 py-6 rounded-2xl border-2 border-dashed border-border hover:border-violet-400 dark:hover:border-violet-600 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-all disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
          aria-label="Add a new level"
        >
          <Plus size={18} />
          <span className="text-sm font-semibold">
            {config.length >= MAX_LEVELS
              ? `Maximum ${MAX_LEVELS} levels reached`
              : `Add Level ${config.length + 1}`}
          </span>
        </button>
      </div>

      {/* Color reference */}
      <div className="p-4 bg-card border border-border rounded-xl text-sm">
        <p className="font-semibold text-foreground mb-2">Quick Color Reference</p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {[
            ['Gray',   '#6B7280'], ['Amber',  '#F59E0B'], ['Red',    '#EF4444'],
            ['Violet', '#8B5CF6'], ['Gold',   '#D97706'], ['Blue',   '#3B82F6'],
            ['Green',  '#22C55E'], ['Pink',   '#EC4899'],
          ].map(([name, hex]) => (
            <div key={hex} className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full border border-border inline-block" style={{ backgroundColor: hex }} />
              <span>{name} — {hex}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
