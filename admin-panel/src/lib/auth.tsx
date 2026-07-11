import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, req } from './api';

interface AuthCtx { user: any; login: (e: string, p: string) => Promise<void>; logout: () => void; loading: boolean }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // SECURITY: localStorage is readable by any JS running on this origin
    // (XSS, malicious browser extensions, dev tools). Migrating the admin
    // session to an httpOnly + Secure + SameSite=Strict cookie issued by the
    // API server is the right long-term fix; that requires a backend change
    // (set-cookie on /api/auth/login, parse it server-side, drop the bearer
    // header from this client). Tracked, not done here to keep scope small.
    const token = localStorage.getItem('voxlink_admin_token');
    const u = localStorage.getItem('voxlink_admin_user');
    if (!token || !u) {
      setLoading(false);
      return;
    }
    api.dashboard().then(() => {
      try { setUser(JSON.parse(u)); } catch {}
    }).catch((err: any) => {
      const msg = err?.message ?? '';
      const isAuthError = msg.includes('Session expired') || msg.includes('401') || msg.includes('Unauthorized');
      if (isAuthError) {
        // SECURITY: see note above — should be replaced by httpOnly cookie clear.
        localStorage.removeItem('voxlink_admin_token');
        localStorage.removeItem('voxlink_admin_user');
      } else {
        try { setUser(JSON.parse(u)); } catch {}
      }
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user: u } = await api.login(email, password);
    if (u.role !== 'admin') throw new Error('Not an admin account');
    // SECURITY: storing the bearer token in localStorage exposes it to XSS.
    // Replace with a server-set httpOnly cookie when backend support lands.
    localStorage.setItem('voxlink_admin_token', token);
    localStorage.setItem('voxlink_admin_user', JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    // SECURITY FIX: Invalidate the token SERVER-SIDE before clearing local
    // state. This sets `token_invalidated_at` on the user row so even if the
    // token was exfiltrated (XSS, log leak, shoulder-surf), it can never be
    // reused after the admin clicks "Logout". Fire-and-forget: don't block
    // the UI on network failure — clearing localStorage is the fallback that
    // always works locally.
    req('POST', '/auth/logout', {}).catch(() => {
      // Best-effort: if the server is unreachable, the token will expire
      // naturally (7 days) but can no longer be refreshed.
    });
    localStorage.removeItem('voxlink_admin_token');
    localStorage.removeItem('voxlink_admin_user');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout, loading }}>{children}</Ctx.Provider>;
}
