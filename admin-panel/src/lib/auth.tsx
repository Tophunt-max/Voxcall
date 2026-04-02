import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';

interface AuthCtx { user: any; login: (e: string, p: string) => Promise<void>; logout: () => void; loading: boolean }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    localStorage.setItem('voxlink_admin_token', token);
    localStorage.setItem('voxlink_admin_user', JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('voxlink_admin_token');
    localStorage.removeItem('voxlink_admin_user');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout, loading }}>{children}</Ctx.Provider>;
}
