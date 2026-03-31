import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@voxlink.app');
  const [password, setPassword] = useState('admin123');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await login(email, password); }
    catch (err: any) { setError(err.message || 'Login failed. Check credentials.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left decorative panel */}
      <div className="hidden lg:flex flex-1 sidebar-bg items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="absolute rounded-full border border-white/30"
              style={{ width: `${60 + i * 40}px`, height: `${60 + i * 40}px`, left: `${20 + i * 3}%`, top: `${10 + i * 4}%`, opacity: 0.5 - i * 0.02 }} />
          ))}
        </div>
        <div className="relative text-center">
          <div className="w-20 h-20 rounded-3xl gradient-purple flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <span className="text-white font-black text-3xl">V</span>
          </div>
          <h1 className="text-4xl font-black text-white mb-3">VoxLink</h1>
          <p className="text-white/50 text-lg font-medium">Admin Console</p>
          <div className="mt-10 grid grid-cols-2 gap-4 max-w-xs mx-auto">
            {[['Users', 'Manage all platform users'], ['Hosts', 'Control host accounts'], ['Revenue', 'Track coin economy'], ['Content', 'Manage FAQs']].map(([t, d]) => (
              <div key={t} className="bg-white/5 rounded-xl p-3 text-left border border-white/5">
                <p className="text-white font-semibold text-sm">{t}</p>
                <p className="text-white/40 text-xs mt-0.5">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            <div className="w-14 h-14 rounded-2xl gradient-purple flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-white font-black text-2xl">V</span>
            </div>
            <h1 className="font-black text-2xl">VoxLink Admin</h1>
          </div>

          <h2 className="font-bold text-2xl text-foreground mb-1">Welcome back</h2>
          <p className="text-muted-foreground text-sm mb-7">Sign in to your admin account</p>

          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="text-sm font-semibold block mb-1.5">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"
                  className="w-full pl-10 pr-4 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="admin@voxlink.app"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold block mb-1.5">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 border border-border rounded-xl text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPwd(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full gradient-purple text-white rounded-xl py-3 text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity shadow-lg mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign In to Admin Console'}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Default: <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">admin@voxlink.app</code> / <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">admin123</code>
          </p>
        </div>
      </div>
    </div>
  );
}
