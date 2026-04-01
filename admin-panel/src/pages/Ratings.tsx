import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Table } from '@/components/ui/Table';
import { StatCard } from '@/components/ui/StatCard';
import { Star, Award, MessageCircle } from 'lucide-react';

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={13} className={i <= n ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'} />
      ))}
    </div>
  );
}

export default function Ratings() {
  const [ratings, setRatings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.ratings().then(setRatings).catch(console.error).finally(() => setLoading(false));
  }, []);

  const avg = ratings.length ? (ratings.reduce((s, r) => s + r.stars, 0) / ratings.length).toFixed(1) : '—';
  const withComments = ratings.filter(r => r.comment).length;
  const fiveStars = ratings.filter(r => r.stars === 5).length;

  const cols = [
    { key: 'host', header: 'Host',
      render: (r: any) => (
        <div>
          <p className="font-semibold text-sm">{r.host_display_name || r.host_id}</p>
          <p className="text-xs text-muted-foreground">Host</p>
        </div>
      )
    },
    { key: 'user', header: 'Reviewer', className: 'hidden sm:table-cell',
      render: (r: any) => <span className="text-sm">{r.user_name || r.user_id}</span>
    },
    { key: 'stars', header: 'Rating',
      render: (r: any) => (
        <div className="flex items-center gap-2">
          <Stars n={r.stars} />
          <span className="text-xs font-semibold text-muted-foreground">{r.stars}/5</span>
        </div>
      )
    },
    { key: 'comment', header: 'Comment', className: 'hidden md:table-cell',
      render: (r: any) => r.comment
        ? <span className="text-sm text-muted-foreground italic">"{r.comment}"</span>
        : <span className="text-xs text-muted-foreground">—</span>
    },
    { key: 'date', header: 'Date', className: 'hidden lg:table-cell',
      render: (r: any) => <span className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '—'}</span>
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-bold text-lg">Ratings & Reviews</h2>
        <p className="text-sm text-muted-foreground">All user reviews for hosts</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Star} label="Total Reviews" value={ratings.length} gradient="gradient-orange" />
        <StatCard icon={Award} label="Avg. Rating" value={avg} unit="/ 5" gradient="gradient-purple" />
        <StatCard icon={MessageCircle} label="With Comments" value={withComments} gradient="gradient-blue" />
      </div>

      {/* Rating distribution */}
      {ratings.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-semibold text-sm mb-4">Rating Distribution</h3>
          <div className="space-y-2">
            {[5,4,3,2,1].map(n => {
              const count = ratings.filter(r => r.stars === n).length;
              const pct = ratings.length ? Math.round(count / ratings.length * 100) : 0;
              return (
                <div key={n} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 w-12 flex-shrink-0">
                    <span className="text-sm font-semibold">{n}</span>
                    <Star size={11} className="text-amber-400 fill-amber-400" />
                  </div>
                  <div className="flex-1 bg-secondary rounded-full h-2">
                    <div className="h-2 rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-12 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Table columns={cols} data={ratings} loading={loading} empty="No ratings yet" keyFn={r => r.id} />
    </div>
  );
}
