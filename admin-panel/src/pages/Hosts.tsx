import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import {
  Star, CheckCircle, Circle, RefreshCw, Save, Search,
  X, Mail, Phone, Coins, Calendar, Mic, Video, ThumbsUp
} from 'lucide-react';

const LEVELS: Record<number, { name: string; badge: string; color: string; bg: string }> = {
  1: { name: 'Newcomer', badge: '🌱', color: 'text-gray-600', bg: 'bg-gray-100' },
  2: { name: 'Rising',   badge: '⭐', color: 'text-amber-600', bg: 'bg-amber-50' },
  3: { name: 'Expert',   badge: '🔥', color: 'text-red-600', bg: 'bg-red-50' },
  4: { name: 'Pro',      badge: '💎', color: 'text-violet-600', bg: 'bg-violet-50' },
  5: { name: 'Elite',    badge: '👑', color: 'text-yellow-700', bg: 'bg-yellow-50' },
};

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 disabled:opacity-50 ${value ? 'bg-green-500' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-[calc(100%-18px)]' : 'left-1'}`} />
    </button>
  );
}

function LevelBadge({ level }: { level: number }) {
  const l = LEVELS[level] ?? LEVELS[1];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${l.bg} ${l.color}`}>
      {l.badge} Lv.{level} {l.name}
    </span>
  );
}

function HostAvatar({ name, level, size = 'md' }: { name: string; level: number; size?: 'sm' | 'md' | 'lg' }) {
  const lvl = LEVELS[level] ?? LEVELS[1];
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base';
  return (
    <div className="relative flex-shrink-0">
      <div className={`${sz} rounded-xl gradient-purple flex items-center justify-center text-white font-bold`}>
        {name?.[0]?.toUpperCase() || 'H'}
      </div>
      <span className="absolute -top-1 -right-1 text-xs leading-none">{lvl.badge}</span>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium mt-0.5 break-all">{value}</div>
      </div>
    </div>
  );
}

function HostDetailSheet({
  host,
  onClose,
  onSaved,
  toggling,
  onToggle,
}: {
  host: any;
  onClose: () => void;
  onSaved: (msg: string) => void;
  toggling: string | null;
  onToggle: (id: string, field: string, cur: boolean) => void;
}) {
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const [level, setLevel] = useState(String(host.level ?? 1));
  const [audio, setAudio] = useState(String(host.audio_coins_per_minute ?? host.coins_per_minute ?? 5));
  const [video, setVideo] = useState(String(host.video_coins_per_minute ?? 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const qc = useQueryClient();

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await api.updateHost(host.id, {
        level: parseInt(level),
        audio_coins_per_minute: parseInt(audio),
        video_coins_per_minute: parseInt(video),
        coins_per_minute: parseInt(audio),
      });
      qc.invalidateQueries({ queryKey: ['admin-hosts'] });
      onSaved('Host updated successfully!');
      onClose();
    } catch (e: any) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <HostAvatar name={host.display_name || host.name} level={host.level ?? 1} size="md" />
            <div>
              <p className="font-bold text-base leading-tight">{host.display_name || host.name || '—'}</p>
              <LevelBadge level={host.level ?? 1} />
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-secondary text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-border">
          {(['details', 'edit'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
            >
              {t === 'details' ? 'Details' : 'Edit'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {tab === 'details' ? (
            <div>
              <InfoRow icon={<Mail size={14} />} label="Email" value={host.email || '—'} />
              <InfoRow icon={<Phone size={14} />} label="Phone" value={host.phone || '—'} />
              <InfoRow
                icon={<Mic size={14} />}
                label="Audio Rate"
                value={<span className="text-violet-600 font-bold">{host.audio_coins_per_minute ?? host.coins_per_minute ?? '?'} coins/min</span>}
              />
              <InfoRow
                icon={<Video size={14} />}
                label="Video Rate"
                value={<span className="text-blue-600 font-bold">{host.video_coins_per_minute ?? '?'} coins/min</span>}
              />
              <InfoRow
                icon={<Star size={14} />}
                label="Rating"
                value={
                  <span className="flex items-center gap-1">
                    <Star size={13} className="text-amber-400 fill-amber-400" />
                    <span className="font-bold">{(host.rating ?? 0).toFixed(1)}</span>
                    <span className="text-muted-foreground text-xs">({host.review_count ?? 0} reviews)</span>
                  </span>
                }
              />
              <InfoRow
                icon={<Coins size={14} />}
                label="Total Earnings"
                value={<span className="text-amber-600 font-bold">{(host.total_earnings || 0).toLocaleString()} coins</span>}
              />
              <InfoRow
                icon={<Calendar size={14} />}
                label="Joined"
                value={host.created_at ? new Date(host.created_at * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              />
              {host.languages?.length > 0 && (
                <InfoRow icon={<ThumbsUp size={14} />} label="Languages" value={host.languages.join(', ')} />
              )}
              {host.specialties?.length > 0 && (
                <InfoRow icon={<ThumbsUp size={14} />} label="Specialties" value={host.specialties.join(', ')} />
              )}

              <div className="mt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</p>

                <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
                  <span className="text-sm font-medium">Active</span>
                  <Toggle
                    value={!!host.is_active}
                    onChange={() => onToggle(host.id, 'is_active', !!host.is_active)}
                    disabled={toggling === `${host.id}:is_active`}
                  />
                </div>

                <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
                  <span className="text-sm font-medium">⭐ Top Rated</span>
                  <Toggle
                    value={!!host.is_top_rated}
                    onChange={() => onToggle(host.id, 'is_top_rated', !!host.is_top_rated)}
                    disabled={toggling === `${host.id}:is_top_rated`}
                  />
                </div>

                <div className="flex items-center justify-between bg-secondary rounded-xl px-4 py-3">
                  <span className="text-sm font-medium">✅ Identity Verified</span>
                  <Toggle
                    value={!!host.identity_verified}
                    onChange={() => onToggle(host.id, 'identity_verified', !!host.identity_verified)}
                    disabled={toggling === `${host.id}:identity_verified`}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold block mb-2">Host Level</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1,2,3,4,5].map((l) => {
                    const info = LEVELS[l];
                    return (
                      <button
                        key={l}
                        onClick={() => setLevel(String(l))}
                        className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all ${String(l) === level ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}
                      >
                        <span className="text-lg">{info.badge}</span>
                        <span className="text-xs font-semibold mt-0.5">{info.name}</span>
                        <span className="text-xs text-muted-foreground">Lv.{l}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold block mb-1.5">🎤 Audio (coins/min)</label>
                  <input
                    type="number" min="1" max="500"
                    value={audio}
                    onChange={e => setAudio(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold block mb-1.5">📹 Video (coins/min)</label>
                  <input
                    type="number" min="1" max="300"
                    value={video}
                    onChange={e => setVideo(e.target.value)}
                    className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {err && <p className="text-red-500 text-sm">{err}</p>}

              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-secondary transition-colors">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-violet-700 disabled:opacity-60 transition-colors"
                >
                  <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Hosts() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState('');
  const [selectedHost, setSelectedHost] = useState<any>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const { data: allHosts = [], isLoading, error } = useQuery<any[]>({
    queryKey: ['admin-hosts'],
    queryFn: () => api.hosts() as Promise<any[]>,
    staleTime: 30_000,
  });

  const hosts = debouncedSearch
    ? allHosts.filter((h: any) =>
        (h.display_name || h.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (h.email || '').toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : allHosts;

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, field, cur }: { id: string; field: string; cur: boolean }) =>
      api.updateHost(id, { [field]: !cur ? 1 : 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-hosts'] });
      showToast('Host updated');
    },
    onError: (e: any) => showToast('Error: ' + e.message),
    onSettled: () => setToggling(null),
  });

  const recalcMutation = useMutation({
    mutationFn: () => api.recalculateHostLevels(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-hosts'] });
      showToast('All host levels recalculated!');
    },
    onError: (e: any) => showToast('Error: ' + e.message),
  });

  const handleToggle = (id: string, field: string, cur: boolean) => {
    const key = `${id}:${field}`;
    if (toggling === key) return;
    setToggling(key);
    toggleMutation.mutate({ id, field, cur });
    if (selectedHost?.id === id) {
      setSelectedHost((h: any) => ({ ...h, [field]: !cur }));
    }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          Failed to load hosts: {(error as Error).message}
        </div>
      )}

      {selectedHost && (
        <HostDetailSheet
          host={selectedHost}
          onClose={() => setSelectedHost(null)}
          onSaved={showToast}
          toggling={toggling}
          onToggle={handleToggle}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">Hosts</h2>
          <p className="text-sm text-muted-foreground">{hosts.length} registered hosts — manage levels, rates & status</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="pl-8 pr-4 py-2 text-sm border border-border rounded-xl bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 w-full sm:w-44"
              placeholder="Search hosts..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <RefreshCw size={13} className={recalcMutation.isPending ? 'animate-spin' : ''} />
            {recalcMutation.isPending ? 'Calc…' : 'Auto Level'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(LEVELS).map(([l, info]) => (
          <div key={l} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${info.bg} ${info.color}`}>
            {info.badge} Lv.{l} {info.name}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : hosts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No hosts registered yet</div>
      ) : (
        <div className="space-y-2">
          {hosts.map((h: any) => (
            <button
              key={h.id}
              onClick={() => setSelectedHost(h)}
              className="w-full text-left bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-secondary/50 active:bg-secondary transition-colors"
            >
              <HostAvatar name={h.display_name || h.name} level={h.level ?? 1} size="sm" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{h.display_name || h.name}</p>
                  <LevelBadge level={h.level ?? 1} />
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Mic size={10} /> {h.audio_coins_per_minute ?? h.coins_per_minute ?? '?'}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Video size={10} /> {h.video_coins_per_minute ?? '?'}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Star size={10} className="text-amber-400 fill-amber-400" /> {(h.rating ?? 0).toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <Badge variant={h.is_online ? 'success' : 'default'}>
                  {h.is_online ? 'Online' : 'Offline'}
                </Badge>
                <div className="flex items-center gap-1.5">
                  {h.identity_verified && <CheckCircle size={12} className="text-green-500" />}
                  {h.is_top_rated && <Star size={12} className="text-amber-400 fill-amber-400" />}
                  <div
                    onClick={e => { e.stopPropagation(); handleToggle(h.id, 'is_active', !!h.is_active); }}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${h.is_active ? 'bg-green-500' : 'bg-slate-200'} ${toggling === `${h.id}:is_active` ? 'opacity-50' : ''}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${h.is_active ? 'left-[calc(100%-18px)]' : 'left-0.5'}`} />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
