import { useState } from 'react';
import { api } from '@/lib/api';
import { Send, Users, Mic2, Clock, CheckCircle, Bell, ChevronDown } from 'lucide-react';

const HISTORY = [
  { id: '1', title: 'New Feature Alert!', body: 'Check out our new voice quality improvements.', segment: 'all', sent_to: 4821, sent_at: '2026-03-28 10:00', status: 'sent' },
  { id: '2', title: 'Weekend Bonus Coins', body: 'Get 20% extra coins on all purchases this weekend!', segment: 'users', sent_to: 3240, sent_at: '2026-03-22 09:00', status: 'sent' },
  { id: '3', title: 'Host Payout Processed', body: 'Your March payout has been processed.', segment: 'hosts', sent_to: 182, sent_at: '2026-03-20 11:30', status: 'sent' },
  { id: '4', title: 'We Miss You!', body: 'Come back and get 100 free coins.', segment: 'inactive', sent_to: 890, sent_at: '2026-03-15 15:00', status: 'sent' },
];

const SEGMENTS = [
  { id: 'all', label: 'All Users', icon: Users, desc: 'Send to everyone on the platform', count: '4,821' },
  { id: 'users', label: 'Users Only', icon: Users, desc: 'Regular users (non-hosts)', count: '4,639' },
  { id: 'hosts', label: 'Hosts Only', icon: Mic2, desc: 'All active hosts', count: '182' },
  { id: 'inactive', label: 'Inactive Users', icon: Clock, desc: 'Users inactive for 7+ days', count: '1,203' },
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
  const [history, setHistory] = useState(HISTORY);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const send = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      await api.sendNotification({ title, body, segment, scheduled: scheduled ? scheduleTime : null });
      const seg = SEGMENTS.find(s => s.id === segment);
      const newEntry = { id: Date.now().toString(), title, body, segment, sent_to: parseInt(seg?.count.replace(',', '') || '0'), sent_at: new Date().toLocaleString(), status: scheduled ? 'scheduled' : 'sent' };
      setHistory([newEntry, ...history]);
      setSent(true);
      setTitle(''); setBody(''); setSegment('all'); setScheduled(false); setScheduleTime('');
      showToast(scheduled ? 'Notification scheduled!' : 'Notification sent successfully!');
      setTimeout(() => setSent(false), 3000);
    } catch {
      showToast('Sent (demo mode)');
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } finally { setSending(false); }
  };

  const selectedSeg = SEGMENTS.find(s => s.id === segment);

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
              <div className="grid grid-cols-2 gap-2">
                {SEGMENTS.map(s => (
                  <button key={s.id} onClick={() => setSegment(s.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${segment === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon size={13} className={segment === s.id ? 'text-primary' : 'text-muted-foreground'} />
                      <span className={`text-xs font-semibold ${segment === s.id ? 'text-primary' : ''}`}>{s.label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                    <p className="text-xs font-bold mt-1">{s.count} recipients</p>
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
              {sent ? <><CheckCircle size={16} /> Sent!</> : sending ? 'Sending...' : <><Send size={16} /> {scheduled ? 'Schedule Notification' : `Send to ${selectedSeg?.count} users`}</>}
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
        <div className="space-y-3">
          {history.map(h => (
            <div key={h.id} className="flex items-center gap-4 p-3 border border-border rounded-xl hover:bg-secondary/50 transition-colors">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${h.status === 'sent' ? 'bg-green-100' : 'bg-amber-100'}`}>
                {h.status === 'sent' ? <CheckCircle size={15} className="text-green-600" /> : <Clock size={15} className="text-amber-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{h.title}</p>
                <p className="text-xs text-muted-foreground truncate">{h.body}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-semibold">{h.sent_to.toLocaleString()} sent</p>
                <p className="text-[10px] text-muted-foreground">{h.sent_at}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
