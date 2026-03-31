import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@voxlink.app');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await login(email, password); }
    catch (err: any) { setError(err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-4">
            <span className="text-white font-bold text-2xl">V</span>
          </div>
          <h1 className="text-2xl font-bold">VoxLink Admin</h1>
          <p className="text-muted-foreground text-sm mt-1">Sign in to manage the platform</p>
        </div>
        <form onSubmit={submit} className="bg-card border border-border rounded-xl p-6 space-y-4">
          {error && <p className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
          <div>
            <label className="text-sm font-medium block mb-1.5">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-xs text-muted-foreground mt-4">Default: admin@voxlink.app / admin123</p>
      </div>
    </div>
  );
}
