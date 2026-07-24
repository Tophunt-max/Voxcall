import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Trophy, Save, RefreshCw, Info, ChevronRight, Coins, Plus, Trash2, Sparkles, ListChecks } from 'lucide-react';

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

// ── Flexible level criteria ──────────────────────────────────────────────────
type MetricKey =
  | 'review_count' | 'rating' | 'total_minutes' | 'total_earnings'
  | 'unique_callers' | 'answer_rate' | 'favorite_count'
  | 'streak_max' | 'tenure_days' | 'kyc_verified'
  | 'online_minutes' | 'active_days' | 'avg_call_minutes' | 'repeat_callers';
type CriterionOp = '>=' | '==';
type MetricKind = 'int' | 'rating' | 'percent' | 'bool';

interface Criterion {
  metric: MetricKey;
  op: CriterionOp;
  value: number;
}

interface MetricDef {
  key: MetricKey;
  label: string;
  kind: MetricKind;
  defaultOp: CriterionOp;
}

interface LevelDef {
  level: number;
  name: string;
  badge: string;
  color: string;
  /** Flexible per-level thresholds — a host must satisfy ALL of them. */
  criteria: Criterion[];
  // Legacy mirror fields (server keeps them in sync with `criteria`). Kept so
  // an older saved config still loads; the editor writes `criteria` on save.
  min_calls?: number;
  min_rating?: number;
  min_minutes?: number;
  min_earnings?: number;
  coin_reward: number;
  description: string;
  perks: LevelPerks;
}

/**
 * Fallback metric catalog — mirrors METRIC_REGISTRY in
 * api-server/src/lib/levels.ts. The live catalog is fetched from
 * `/admin/level-config/meta` on load (single source of truth); this constant
 * is only used until that request resolves or if it fails.
 */
const FALLBACK_METRICS: MetricDef[] = [
  { key: 'review_count',   label: 'Rated calls',           kind: 'int',     defaultOp: '>=' },
  { key: 'rating',         label: 'Average rating',        kind: 'rating',  defaultOp: '>=' },
  { key: 'total_minutes',  label: 'Total talk-minutes',    kind: 'int',     defaultOp: '>=' },
  { key: 'total_earnings', label: 'Total coins earned',    kind: 'int',     defaultOp: '>=' },
  { key: 'unique_callers', label: 'Unique callers',        kind: 'int',     defaultOp: '>=' },
  { key: 'answer_rate',    label: 'Answer rate',           kind: 'percent', defaultOp: '>=' },
  { key: 'favorite_count', label: 'Followers (favorites)', kind: 'int',     defaultOp: '>=' },
  { key: 'streak_max',     label: 'Best daily streak',     kind: 'int',     defaultOp: '>=' },
  { key: 'tenure_days',    label: 'Days on platform',      kind: 'int',     defaultOp: '>=' },
  { key: 'kyc_verified',   label: 'KYC verified',          kind: 'bool',    defaultOp: '==' },
  { key: 'online_minutes',   label: 'Total online-time (min)', kind: 'int', defaultOp: '>=' },
  { key: 'active_days',      label: 'Active days (lifetime)',  kind: 'int', defaultOp: '>=' },
  { key: 'avg_call_minutes', label: 'Avg call length (min)',   kind: 'int', defaultOp: '>=' },
  { key: 'repeat_callers',   label: 'Repeat callers',          kind: 'int', defaultOp: '>=' },
];

const DEFAULT_CONFIG: LevelDef[] = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0,   min_minutes: 0,    min_earnings: 0,     criteria: [], coin_reward: 0,    description: 'New to the platform', perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 0 } },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, min_minutes: 50,   min_earnings: 500,   criteria: [], coin_reward: 100,  description: 'Getting established',  perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 1 } },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, min_minutes: 300,  min_earnings: 3000,  criteria: [], coin_reward: 300,  description: 'Proven expertise',    perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.72, rank_boost: 2 } },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, min_minutes: 1000, min_earnings: 15000, criteria: [], coin_reward: 500,  description: 'Professional tier',   perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.75, rank_boost: 3 } },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, min_minutes: 2500, min_earnings: 50000, criteria: [], coin_reward: 1000, description: 'Top performer',       perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 } },
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
 * Synthesize the classic four criteria from a rung's legacy min_* fields.
 * Used to upgrade a pre-v2 saved config (which had no `criteria`) into the
 * editor's criteria model so it renders correctly.
 */
function criteriaFromLegacy(l: any): Criterion[] {
  const out: Criterion[] = [];
  const mc = Math.max(0, parseInt(String(l?.min_calls)) || 0);
  const mr = Math.min(5, Math.max(0, parseFloat(String(l?.min_rating)) || 0));
  const mm = Math.max(0, parseInt(String(l?.min_minutes)) || 0);
  const me = Math.max(0, parseInt(String(l?.min_earnings)) || 0);
  if (mc > 0) out.push({ metric: 'review_count', op: '>=', value: mc });
  if (mr > 0) out.push({ metric: 'rating', op: '>=', value: mr });
  if (mm > 0) out.push({ metric: 'total_minutes', op: '>=', value: mm });
  if (me > 0) out.push({ metric: 'total_earnings', op: '>=', value: me });
  return out;
}

/** Effective criteria for a rung — explicit `criteria` win, else synthesized. */
function deriveCriteria(l: any): Criterion[] {
  if (Array.isArray(l?.criteria) && l.criteria.length > 0) {
    return l.criteria
      .filter((c: any) => c && typeof c.metric === 'string')
      .map((c: any) => ({
        metric: c.metric as MetricKey,
        op: c.op === '==' ? '==' : '>=',
        value: Number(c.value) || 0,
      }));
  }
  return criteriaFromLegacy(l);
}

/** Normalize a raw config array (from API/preset) into the editor's model. */
function normalizeForEditor(data: any[]): LevelDef[] {
  return data.map((l: any, i: number) => {
    const fallback = DEFAULT_CONFIG[i] ?? generateNewLevelDefaults(i + 1);
    const savedPerks = l?.perks || {};
    const legacyMax = Number(savedPerks.max_rate) || fallback.perks.max_rate;
    const audio = Number(savedPerks.max_audio_rate) || legacyMax;
    const video = Number(savedPerks.max_video_rate) || legacyMax;
    const randomAudio = Number(savedPerks.random_audio_rate) || fallback.perks.random_audio_rate;
    const randomVideo = Number(savedPerks.random_video_rate) || fallback.perks.random_video_rate;
    return {
      ...fallback,
      ...l,
      level: i + 1,
      criteria: deriveCriteria(l),
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
  });
}

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
  const min_calls = base.min_calls! + overflow * 1000;
  const min_rating = Math.min(5, base.min_rating! + overflow * 0.05);
  const min_minutes = base.min_minutes! + overflow * 2500;
  const min_earnings = base.min_earnings! + overflow * 50000;
  const coin_reward = base.coin_reward + overflow * 500;
  const earning_share = Math.min(0.95, base.perks.earning_share + overflow * 0.02);
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
    // A fresh rung starts with the classic work-based criteria; the admin can
    // add richer metrics (unique callers, answer rate, KYC…) below.
    criteria: [
      { metric: 'review_count', op: '>=', value: min_calls },
      { metric: 'rating', op: '>=', value: min_rating },
      { metric: 'total_minutes', op: '>=', value: min_minutes },
      { metric: 'total_earnings', op: '>=', value: min_earnings },
    ],
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
  const [metrics, setMetrics] = useState<MetricDef[]>(FALLBACK_METRICS);
  const [presets, setPresets] = useState<{ default?: any[]; recommended?: any[] }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const metricByKey = (k: MetricKey) => metrics.find(m => m.key === k) ?? FALLBACK_METRICS.find(m => m.key === k)!;

  useEffect(() => {
    // Load the metric catalog + presets (best-effort) and the saved config in
    // parallel. The catalog drives the criteria dropdowns; if it fails we fall
    // back to the mirrored constant so the editor still works.
    api.getLevelConfigMeta()
      .then((meta) => {
        if (Array.isArray(meta?.metrics) && meta.metrics.length) setMetrics(meta.metrics);
        if (meta?.presets) setPresets(meta.presets);
      })
      .catch(() => { /* fall back to FALLBACK_METRICS */ });

    api.getLevelConfig()
      .then(data => {
        if (Array.isArray(data) && data.length >= MIN_LEVELS && data.length <= MAX_LEVELS) {
          setConfig(normalizeForEditor(data));
        }
      })
      .catch(() => toast.error('Failed to load level config'))
      .finally(() => setLoading(false));
  }, []);

  const updateLevel = (idx: number, field: keyof LevelDef, val: string) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'coin_reward') return { ...l, [field]: Math.max(0, parseInt(val) || 0) };
      return { ...l, [field]: val };
    }));
  };

  // ── Criteria editing ────────────────────────────────────────────────────
  const addCriterion = (levelIdx: number) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== levelIdx) return l;
      // Pick the first metric not already used on this rung.
      const used = new Set(l.criteria.map(c => c.metric));
      const nextMetric = metrics.find(m => !used.has(m.key));
      if (!nextMetric) {
        toast.error('All available metrics are already added to this level.');
        return l;
      }
      const value = nextMetric.kind === 'bool' ? 1 : 0;
      return { ...l, criteria: [...l.criteria, { metric: nextMetric.key, op: nextMetric.defaultOp, value }] };
    }));
  };

  const removeCriterion = (levelIdx: number, critIdx: number) => {
    setConfig(prev => prev.map((l, i) =>
      i === levelIdx ? { ...l, criteria: l.criteria.filter((_, ci) => ci !== critIdx) } : l,
    ));
  };

  const updateCriterion = (levelIdx: number, critIdx: number, patch: Partial<Criterion>) => {
    setConfig(prev => prev.map((l, i) => {
      if (i !== levelIdx) return l;
      return {
        ...l,
        criteria: l.criteria.map((c, ci) => {
          if (ci !== critIdx) return c;
          const merged = { ...c, ...patch };
          // When the metric changes, reset op to the metric default and clamp
          // the value to that metric's kind.
          if (patch.metric && patch.metric !== c.metric) {
            const def = metricByKey(patch.metric);
            merged.op = def.defaultOp;
            merged.value = def.kind === 'bool' ? 1 : 0;
          }
          return merged;
        }),
      };
    }));
  };

  // Convert a stored criterion value to what the input should show (percent is
  // stored as a 0–1 fraction but displayed 0–100).
  const displayValue = (c: Criterion): number => {
    const def = metricByKey(c.metric);
    if (def.kind === 'percent') return Math.round((c.value || 0) * 100);
    return c.value ?? 0;
  };

  // Parse an input string back into the stored (canonical) criterion value.
  const parseValue = (metric: MetricKey, raw: string): number => {
    const def = metricByKey(metric);
    switch (def.kind) {
      case 'percent': return Math.min(1, Math.max(0, (parseFloat(raw) || 0) / 100));
      case 'rating': return Math.min(5, Math.max(0, parseFloat(raw) || 0));
      case 'bool': return (parseInt(raw) || 0) >= 1 ? 1 : 0;
      default: return Math.max(0, parseInt(raw) || 0);
    }
  };

  // Perks are nested; earning_share is edited as a percentage (10–95) but
  // stored as a fraction (0.10–0.95) to match the backend schema.
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

  // Load a preset ladder (default or recommended) into the editor. Does NOT
  // save — the admin reviews then hits "Save Config".
  const loadPreset = (which: 'default' | 'recommended') => {
    const preset = presets[which];
    if (!Array.isArray(preset) || !preset.length) {
      toast.error('Preset not available.');
      return;
    }
    setConfig(normalizeForEditor(preset));
    toast.success(`Loaded the ${which} ladder — review, then Save Config to apply.`);
  };

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
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy size={20} className="text-violet-500" /> Level System Configuration
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure per-level criteria, coin rewards, and badges for each host level. Changes apply on next recalculation.
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => loadPreset('recommended')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 text-sm font-medium transition-all hover:bg-violet-100 dark:hover:bg-violet-900/40"
            title="Load a richer ladder that gates on quality, trust & consistency (unique callers, answer rate, followers, KYC…). Review, then Save."
          >
            <Sparkles size={15} />
            Load Recommended
          </button>
          <button
            onClick={() => loadPreset('default')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-secondary text-foreground text-sm font-medium transition-all"
            title="Reset the editor to the classic 4-metric ladder. Review, then Save."
          >
            <RefreshCw size={15} />
            Load Default
          </button>
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
          <strong>How levels work:</strong> Each level has a list of <strong>criteria</strong> (any number, different per level). Hosts are <strong>auto-promoted in real time</strong> when they meet <strong>ALL</strong> of a level's criteria, and the one-time Coin Reward is credited automatically.
          Available metrics: rated calls, average rating, talk-minutes, coins earned, unique callers, answer rate, followers, daily streak, days on platform, KYC verified, total online-time, active days, avg call length &amp; repeat callers.
          Level 1 is the starting level (no criteria). <strong>Perks</strong> per level: Max Audio/Video Rate, Earning Share and Rank Boost.
          A host can charge up to <strong>+{HOST_RATE_BONUS} coins/min</strong> above each cap.
          Use <strong>"Load Recommended"</strong> for a richer quality/trust ladder, then <strong>"Recalculate All Host Levels"</strong> to back-fill existing hosts.
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
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
                <Coins size={14} className="text-amber-500" />
                <span className="text-sm font-bold text-amber-700 dark:text-amber-400">+{lvl.coin_reward} coins</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">earns</span>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{Math.round(lvl.perks.earning_share * 100)}%</span>
              </div>
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

            {/* Identity fields grid */}
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <Field label="Level #" value={lvl.level} readOnly />
              <Field label="Badge Emoji" value={lvl.badge} onChange={v => updateLevel(idx, 'badge', v)} />
              <Field label="Level Name" value={lvl.name} onChange={v => updateLevel(idx, 'name', v)} />
              <Field label="Color (hex)" value={lvl.color} onChange={v => updateLevel(idx, 'color', v)} />
              <Field label="Coin Reward" value={lvl.coin_reward} type="number" min={0} onChange={v => updateLevel(idx, 'coin_reward', v)} />
            </div>

            {/* Criteria editor */}
            <div className="px-5 pb-2">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <ListChecks size={13} /> Promotion criteria {idx === 0 ? '(starting level — none)' : '(host must meet ALL)'}
                </label>
                <button
                  type="button"
                  onClick={() => addCriterion(idx)}
                  disabled={lvl.criteria.length >= metrics.length}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-secondary text-xs font-medium text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={13} /> Add criterion
                </button>
              </div>

              {lvl.criteria.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  {idx === 0 ? 'No requirements — all new hosts start here.' : 'No criteria yet — this level is reachable by everyone. Add at least one criterion.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {lvl.criteria.map((crit, ci) => {
                    const def = metricByKey(crit.metric);
                    const usedElsewhere = new Set(lvl.criteria.filter((_, x) => x !== ci).map(c => c.metric));
                    return (
                      <div key={ci} className="flex items-center gap-2 flex-wrap">
                        {/* Metric */}
                        <select
                          value={crit.metric}
                          onChange={e => updateCriterion(idx, ci, { metric: e.target.value as MetricKey })}
                          className="px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 min-w-[180px]"
                        >
                          {metrics.map(m => (
                            <option key={m.key} value={m.key} disabled={usedElsewhere.has(m.key)}>
                              {m.label}
                            </option>
                          ))}
                        </select>

                        {/* Operator */}
                        <select
                          value={crit.op}
                          onChange={e => updateCriterion(idx, ci, { op: e.target.value as CriterionOp })}
                          className="px-2 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                        >
                          <option value=">=">at least (≥)</option>
                          <option value="==">exactly (=)</option>
                        </select>

                        {/* Value */}
                        {def.kind === 'bool' ? (
                          <select
                            value={crit.value}
                            onChange={e => updateCriterion(idx, ci, { value: parseValue(crit.metric, e.target.value) })}
                            className="px-2 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          >
                            <option value={1}>Yes</option>
                            <option value={0}>No</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={displayValue(crit)}
                              min={0}
                              max={def.kind === 'rating' ? 5 : def.kind === 'percent' ? 100 : undefined}
                              step={def.kind === 'rating' ? 0.1 : 1}
                              onChange={e => updateCriterion(idx, ci, { value: parseValue(crit.metric, e.target.value) })}
                              className="w-28 px-2.5 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                            />
                            {def.kind === 'percent' && <span className="text-xs text-muted-foreground">%</span>}
                            {def.kind === 'rating' && <span className="text-xs text-muted-foreground">/ 5</span>}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => removeCriterion(idx, ci)}
                          className="p-1.5 rounded-lg border border-border bg-card hover:bg-red-50 dark:hover:bg-red-950/30 hover:border-red-300 dark:hover:border-red-800 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-all"
                          aria-label="Remove criterion"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Perks / benefits grid */}
            <div className="px-5 pt-3">
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

            {/* Random call rates per level */}
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
            <div className="px-5 py-5">
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
            <div className="px-5 pb-4 flex items-start gap-2 text-xs text-muted-foreground">
              <ChevronRight size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                {lvl.criteria.length === 0 ? (
                  idx === 0 ? 'Starting level — all new hosts begin here, no requirements' : 'No criteria — reachable by everyone'
                ) : (
                  <>Requires:{' '}
                    {lvl.criteria.map((c, ci) => {
                      const def = metricByKey(c.metric);
                      const shown = def.kind === 'percent'
                        ? `${Math.round((c.value || 0) * 100)}%`
                        : def.kind === 'bool'
                          ? (c.value >= 1 ? 'Yes' : 'No')
                          : (c.value ?? 0).toLocaleString();
                      return (
                        <span key={ci}>
                          {ci > 0 && ', '}
                          <strong>{def.label} {c.op === '==' ? '=' : '≥'} {shown}</strong>
                        </span>
                      );
                    })}
                  </>
                )}
                {lvl.coin_reward > 0 && <> · Reward: <strong className="text-amber-600">{lvl.coin_reward} coins</strong></>}
                {' '}· Perks: <strong className="text-emerald-600">{Math.round(lvl.perks.earning_share * 100)}% earnings</strong>, audio up to <strong>{lvl.perks.max_audio_rate}/min</strong>, video up to <strong>{lvl.perks.max_video_rate}/min</strong>, random <strong className="text-violet-600">{lvl.perks.random_audio_rate}/{lvl.perks.random_video_rate}</strong>, rank +{lvl.perks.rank_boost}
              </span>
            </div>
          </div>
        ))}

        {/* Add level */}
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
