import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Star, CheckCircle, Circle, RefreshCw, Save } from 'lucide-react';

const LEVELS: Record<number, { name: string; badge: string; color: string; bg: string }> = {
  1: { name: 'Newcomer', badge: '🌱', color: 'text-gray-600', bg: 'bg-gray-100' },
  2: { name: 'Rising',   badge: '⭐', color: 'text-amber-600', bg: 'bg-amber-50' },
  3: { name: 'Expert',   badge: '🔥', color: 'text-red-600', bg: 'bg-red-50' },
  4: { name: 'Pro',      badge: '💎', color: 'text-violet-600', bg: 'bg-violet-50' },
  5: { name: 'Elite',    badge: '👑', color: 'text-yellow-700', bg: 'bg-yellow-50' },
};

function Toggle({ value, onChange, color = 'bg-green-500' }: { value: boolean; onChange: () => void; color?: string }) {
  return (
    <button onClick={onChange} className={`w-10 h-5 rounded-full transition-colors relative ${value ? color : 'bg-slate-200'}`}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-[calc(100%-18px)]' : 'left-0.5'}`} />
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

function EditRateModal({ host, onClose, onSaved }: { host: any; onClose: () => void; onSaved: () => void }) {
  const [level, setLevel] = useState(String(host.level ?? 1));
  const [audio, setAudio] = useState(String(host.audio_coins_per_minute ?? host.coins_per_minute ?? 5));
  const [video, setVideo] = useState(String(host.video_coins_per_minute ?? 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

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
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message ?? 'Error saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-bold text-lg">{host.display_name || host.name}</h3>
          <p className="text-sm text-muted-foreground">Edit level & call rates</p>
        </div>

        {/* Level */}
        <div>
          <label className="text-sm font-medium mb-1 block">Host Level</label>
          <div className="grid grid-cols-5 gap-2">
            {[1,2,3,4,5].map((l) => {
              const info = LEVELS[l];
              return (
                <button
                  key={l}
                  onClick={() => setLevel(String(l))}
                  className={`flex flex-col items-center p-2 rounded-xl border-2 transition-all ${String(l) === level ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <span className="text-xl">{info.badge}</span>
                  <span className="text-xs font-semibold mt-1">{info.name}</span>
                  <span className="text-xs text-muted-foreground">Lv.{l}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Rates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">🎤 Audio Rate (coins/min)</label>
            <input
              type="number" min="1" max="200"
              value={audio}
              onChange={(e) => setAudio(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">📹 Video Rate (coins/min)</label>
            <input
              type="number" min="1" max="300"
              value={video}
              onChange={(e) => setVideo(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>

        {err && <p className="text-red-500 text-sm">{err}</p>}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border text-sm font-medium hover:bg-slate-50">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-violet-700 disabled:opacity-60"
          >
            <Save size={15} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HostAvatar({ name, level }: { name: string; level: number }) {
  const lvl = LEVELS[level] ?? LEVELS[1];
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl gradient-purple flex items-center justify-center text-white font-bold text-sm flex-shrink-0 relative">
        {name?.[0]?.toUpperCase() || 'H'}
        <span className="absolute -top-1 -right-1 text-xs leading-none">{lvl.badge}</span>
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm">{name}</p>
        <LevelBadge level={level} />
      </div>
    </div>
  );
}

export default function Hosts() {
  const [hosts, setHosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [editHost, setEditHost] = useState<any>(null);
  const [recalculating, setRecalculating] = useState(false);

  const load = () => { setLoading(true); api.hosts().then(setHosts).finally(() => setLoading(false)); };
  useEffect(load, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const toggle = async (id: string, field: string, cur: boolean) => {
    try {
      await api.updateHost(id, { [field]: !cur ? 1 : 0 });
      load();
      showToast('Host updated');
    } catch (e: any) { showToast('Error: ' + e.message); }
  };

  const recalculateLevels = async () => {
    setRecalculating(true);
    try {
      await api.recalculateHostLevels();
      load();
      showToast('All host levels recalculated!');
    } catch (e: any) { showToast('Error: ' + e.message); }
    finally { setRecalculating(false); }
  };

  const cols = [
    {
      key: 'host', header: 'Host',
      render: (h: any) => <HostAvatar name={h.display_name || h.name} level={h.level ?? 1} />
    },
    { key: 'email', header: 'Email', className: 'hidden md:table-cell',
      render: (h: any) => <span className="text-sm text-muted-foreground">{h.email}</span>
    },
    { key: 'rates', header: 'Call Rates', className: 'hidden sm:table-cell',
      render: (h: any) => (
        <div className="text-xs space-y-0.5">
          <div className="flex items-center gap-1">
            <span>🎤</span>
            <span className="font-semibold text-violet-600">{h.audio_coins_per_minute ?? h.coins_per_minute ?? '?'}</span>
            <span className="text-muted-foreground">coins/min</span>
          </div>
          <div className="flex items-center gap-1">
            <span>📹</span>
            <span className="font-semibold text-blue-600">{h.video_coins_per_minute ?? '?'}</span>
            <span className="text-muted-foreground">coins/min</span>
          </div>
        </div>
      )
    },
    { key: 'rating', header: 'Rating', className: 'hidden lg:table-cell',
      render: (h: any) => (
        <div className="flex items-center gap-1">
          <Star size={12} className="text-amber-400 fill-amber-400" />
          <span className="text-sm font-semibold">{(h.rating ?? 0).toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">({h.review_count ?? 0})</span>
        </div>
      )
    },
    { key: 'status', header: 'Online',
      render: (h: any) => (
        <Badge variant={h.is_online ? 'success' : 'default'}>{h.is_online ? 'Online' : 'Offline'}</Badge>
      )
    },
    { key: 'active', header: 'Active',
      render: (h: any) => <Toggle value={!!h.is_active} onChange={() => toggle(h.id, 'is_active', !!h.is_active)} />
    },
    { key: 'top', header: 'Top Rated', className: 'hidden sm:table-cell',
      render: (h: any) => (
        <button onClick={() => toggle(h.id, 'is_top_rated', !!h.is_top_rated)}>
          <Star size={17} className={h.is_top_rated ? 'text-amber-400 fill-amber-400' : 'text-slate-300'} />
        </button>
      )
    },
    { key: 'verified', header: 'Verified', className: 'hidden lg:table-cell',
      render: (h: any) => (
        <button onClick={() => toggle(h.id, 'identity_verified', !!h.identity_verified)}>
          {h.identity_verified
            ? <CheckCircle size={17} className="text-green-500" />
            : <Circle size={17} className="text-slate-300" />}
        </button>
      )
    },
    { key: 'edit', header: 'Edit',
      render: (h: any) => (
        <button
          onClick={() => setEditHost(h)}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 font-semibold hover:bg-violet-100 transition-colors"
        >
          Edit
        </button>
      )
    },
  ];

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {editHost && (
        <EditRateModal
          host={editHost}
          onClose={() => setEditHost(null)}
          onSaved={() => { load(); showToast('Host updated successfully!'); }}
        />
      )}

      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-bold text-lg">Hosts</h2>
          <p className="text-sm text-muted-foreground">{hosts.length} registered hosts — manage levels, rates & status</p>
        </div>
        <button
          onClick={recalculateLevels}
          disabled={recalculating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={14} className={recalculating ? 'animate-spin' : ''} />
          {recalculating ? 'Calculating…' : 'Auto Level'}
        </button>
      </div>

      {/* Level legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(LEVELS).map(([l, info]) => (
          <div key={l} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${info.bg} ${info.color}`}>
            <span>{info.badge}</span> Lv.{l} {info.name}
          </div>
        ))}
      </div>

      <Table columns={cols} data={hosts} loading={loading} empty="No hosts registered yet" keyFn={h => h.id} />
    </div>
  );
}
