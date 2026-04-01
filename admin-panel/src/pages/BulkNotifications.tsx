import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Send, Users, Mic2, Clock, CheckCircle, Bell } from 'lucide-react';

const SEGMENTS = [
  { id: 'all', label: 'All Users', icon: Users, desc: 'Send to everyone on the platform' },
  { id: 'users', label: 'Users Only', icon: Users, desc: 'Regular users (non-hosts)' },
  { id: 'hosts', label: 'Hosts Only', icon: Mic2, desc: 'All active hosts' },
];

export default function BulkNotifications() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState('all');
  const [scheduled, setScheduled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  useEffect(() => {
    api.notifications().then((data: any[]) => {
      const bulk = data.filter((n: any) => n.type === 'bulk' || n.type === 'system').slice(0, 20);
      setHistory(bulk);
    }).catch(() => {}).finally(() => setHistLoading(false));
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const send = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      const res = await api.sendNotification({ title, body: body, type: 'bulk', target: segment });
      const newEntry = {
        id: Date.now().toString(),
        title,
        body,
        type: 'bulk',
        sent_to: res.sent || 0,
        created_at: Math.floor(Date.now() / 1000),
        status: scheduled ? 'scheduled' : 'sent',
      };
      setHistory(prev => [newEntry, ...prev]);
      setSent(true);
      setTitle(''); setBody(''); setSegment('all'); setScheduled(false); setScheduleTime('');
      showToast(scheduled ? 'Notification scheduled!' : `Notification sent to ${res.sent || 0} users!`);
      setTimeout(() => setSent(false), 3000);
    } catch {
      showToast('Failed to send notification');
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-6">
      {toast && <div className="fixed bottom-5 right-5 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-xl">{toast}</div>}

      <div>
        <h2 className="font-bold text-lg">Bulk Notifications</h2>
        <p className="text-sm text-muted-foreground">Send push notifications to targeted user segments</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-5">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-base">Compose Notification</h3>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Title <span className="text-muted-foreground font-normal">({title.length}/65)</span></label>
              <input maxLength={65} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Weekend Special Offer!" value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Message <span className="text-muted-foreground font-normal">({body.length}/150)</span></label>
              <textarea maxLength={150} rows={3} className="w-full px-3 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                placeholder="Write your notification message..." value={body} onChange={e => setBody(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-semibold block mb-2">Target Segment</label>
              <div className="grid grid-cols-3 gap-2">
                {SEGMENTS.map(s => (
                  <button key={s.id} onClick={() => setSegment(s.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${segment === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon size={13} className={segment === s.id ? 'text-primary' : 'text-muted-foreground'} />
                      <span className={`text-xs font-semibold ${segment === s.id ? 'text-primary' : ''}`}>{s.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-secondary rounded-xl">
              <button onClick={() => setScheduled(!scheduled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${scheduled ? 'bg-primary' : 'bg-border'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${scheduled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
              <div className="flex-1">
                <p className="text-sm font-semibold">Schedule for later</p>
                {scheduled && (
                  <input type="datetime-local" className="mt-2 w-full px-3 py-2 border border-border rounded-xl text-sm bg-background focus:outline-none"
                    value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
                )}
              </div>
            </div>

            <button onClick={send} disabled={!title.trim() || !body.trim() || sending}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all">
              {sent ? <><CheckCircle size={16} /> Sent!</> : sending ? 'Sending...' : <><Send size={16} /> {scheduled ? 'Schedule Notification' : 'Send Notification'}</>}
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="font-bold text-base mb-1">Preview</h3>
          <p className="text-xs text-muted-foreground mb-4">How it looks on device</p>
          <div className="bg-gray-900 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center"><Bell size={12} className="text-white" /></div>
              <span className="text-white/60 text-xs">VoxLink · now</span>
            </div>
            <p className="text-white font-semibold text-sm">{title || 'Your notification title'}</p>
            <p className="text-white/60 text-xs mt-1">{body || 'Your notification message will appear here...'}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold text-base mb-4">Send History</h3>
        {histLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No notifications sent yet</p>
        ) : (
          <div className="space-y-3">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-4 p-3 border border-border rounded-xl hover:bg-secondary/50 transition-colors">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${h.status === 'scheduled' ? 'bg-amber-100' : 'bg-green-100'}`}>
                  {h.status === 'scheduled' ? <Clock size={15} className="text-amber-600" /> : <CheckCircle size={15} className="text-green-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{h.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{h.body}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {h.sent_to !== undefined && <p className="text-xs font-semibold">{h.sent_to} sent</p>}
                  <p className="text-[10px] text-muted-foreground">{h.created_at ? new Date(h.created_at * 1000).toLocaleDateString() : '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
