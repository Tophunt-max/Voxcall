import { useState } from 'react';
import { Zap } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw.trim()) { setErr('Password required'); return; }
    setBusy(true); setErr('');
    setToken(pw.trim());
    try {
      await api.state('user');
      onSuccess();
    } catch (e) {
      setToken('');
      setErr(e instanceof Error ? e.message : 'Wrong password');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="fadein w-full max-w-sm rounded-2xl border border-border bg-gradient-to-b from-card to-card2 p-8 shadow-2xl">
        <div className="grad mb-4 flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-primary/40">
          <Zap size={25} className="text-white" fill="white" />
        </div>
        <h1 className="text-xl font-bold">VoxCall OTA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Self-hosted Expo Updates console. Enter the console password (the <span className="font-mono">CONSOLE_PASSWORD</span> secret set on the worker).
        </p>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Console password"
          className="mt-4 w-full rounded-lg border border-border bg-card2 px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <Button className="mt-3 w-full" disabled={busy} onClick={submit}>{busy ? 'Checking…' : 'Unlock console'}</Button>
        {err && <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
      </div>
    </div>
  );
}
