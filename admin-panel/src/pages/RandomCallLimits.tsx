import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shuffle, Save, Info, Crown, Ticket } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Random Call Limits — dedicated admin page (sidebar → CALLS).
// ─────────────────────────────────────────────────────────────────────────────
// Anti-abuse knobs for the random matchmaker (app_settings keys read by
// api-server/src/routes/match.ts). Moved out of the crowded Settings page into
// its own screen so operators can find + tune them quickly.
//
// Behaviour recap wired on the backend:
//   • Daily cap counts a FREE user's matches in a rolling 24h window. 0 = off.
//   • 👑 VIP users always bypass the daily cap.
//   • After the cap, a user still holding Random Call free-minute cards keeps
//     matching (1 card = 1 min); with zero cards they get the "resets in 24h"
//     popup + a live countdown.
//   • Decline cooldown blocks serial decliners; no-repeat window spaces out
//     re-matching the same host.

interface FieldDef {
  key: string;
  label: string;
  hint: string;
  icon?: typeof Info;
}

const FIELDS: FieldDef[] = [
  {
    key: 'random_calls_per_day_limit',
    label: 'Daily random-call limit (per free user)',
    hint: 'Max random matches a FREE user can get in a rolling 24-hour window. 0 = unlimited. 👑 VIP users always bypass this cap. After the limit, a user holding Random Call cards keeps matching (1 card = 1 min); only with zero cards do they see the "resets in 24h" popup.',
    icon: Ticket,
  },
  {
    key: 'random_decline_cooldown_count',
    label: 'Decline cooldown — trigger count',
    hint: "If a user's last N random matches were ALL declined / no-answer, a cooldown kicks in (anti-grief). 0 = disabled. Applies to VIP too. Typical: 3.",
  },
  {
    key: 'random_decline_cooldown_min',
    label: 'Decline cooldown — duration (minutes)',
    hint: 'How long the decline cooldown lasts once triggered. Only used when the trigger count above is > 0. Default 5.',
  },
  {
    key: 'random_match_repeat_block_min',
    label: 'No-repeat window (minutes)',
    hint: 'Block re-matching the SAME host for this many minutes. 0 = off (recommended for small host rosters, otherwise users hit "no host available"). Demand is still spread softly via weighted selection.',
  },
];

const DEFAULTS: Record<string, string> = {
  random_calls_per_day_limit: '0',
  random_decline_cooldown_count: '0',
  random_decline_cooldown_min: '5',
  random_match_repeat_block_min: '0',
};

export default function RandomCallLimits() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const load = useCallback(async (initial = false) => {
    try {
      const d = await api.settings();
      setValues((prev) => {
        const next = { ...DEFAULTS, ...prev };
        for (const f of FIELDS) {
          if (!dirtyRef.current[f.key] && d[f.key] != null) next[f.key] = String(d[f.key]);
        }
        return next;
      });
    } catch {
      if (initial) toast.error('Failed to load limits');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const onFocus = () => load(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const setField = (key: string, value: string) => {
    // Keep it numeric + non-negative.
    const clean = value.replace(/[^0-9]/g, '');
    setValues((prev) => ({ ...prev, [key]: clean }));
    setDirty((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  const dirtyCount = Object.keys(dirty).length;

  const save = async () => {
    setSaving(true);
    try {
      // Only send the four keys this page owns.
      const payload: Record<string, string> = {};
      for (const f of FIELDS) payload[f.key] = values[f.key] ?? DEFAULTS[f.key];
      await api.updateSettings(payload);
      setDirty({});
      toast.success('Saved — random-call limits pushed live');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const dailyLimit = parseInt(values.random_calls_per_day_limit || '0', 10) || 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl gradient-purple flex items-center justify-center shadow-lg">
            <Shuffle size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Random Call Limits</h2>
            <p className="text-sm text-muted-foreground">Anti-abuse controls for the random matchmaker</p>
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-purple text-white text-sm font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          <Save size={15} />
          {saving ? 'Saving…' : dirtyCount > 0 ? `Save (${dirtyCount})` : 'Saved'}
        </button>
      </div>

      {/* VIP note */}
      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <Crown size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          <span className="font-bold">VIP users always bypass the daily cap.</span> After a free user hits the limit,
          they can still make random calls while they hold <span className="font-semibold">Random Call cards</span> (1 card = 1 minute).
          With no cards left, they see a popup with a live countdown to the 24-hour reset.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin w-7 h-7 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {FIELDS.map((f) => {
            const Icon = f.icon || Info;
            return (
              <div key={f.key} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon size={15} className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-semibold text-foreground mb-1">{f.label}</label>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">{f.hint}</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={values[f.key] ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className="w-32 px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                      />
                      {parseInt(values[f.key] || '0', 10) === 0 && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {f.key === 'random_match_repeat_block_min' || f.key === 'random_decline_cooldown_count'
                            ? 'Off'
                            : f.key === 'random_calls_per_day_limit'
                            ? 'Unlimited'
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Live summary */}
          <div className="bg-secondary/50 border border-border rounded-xl p-4">
            <p className="text-xs font-bold text-muted-foreground tracking-wide mb-2">CURRENT BEHAVIOUR</p>
            <p className="text-sm text-foreground leading-relaxed">
              {dailyLimit > 0 ? (
                <>Free users get <span className="font-bold text-violet-500">{dailyLimit}</span> random {dailyLimit === 1 ? 'call' : 'calls'} per 24h,
                then must use Random Call cards or wait for the reset. </>
              ) : (
                <>Random calls are <span className="font-bold text-violet-500">unlimited</span> for everyone (no daily cap). </>
              )}
              VIP users are never capped.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
