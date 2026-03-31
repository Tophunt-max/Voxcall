import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';

interface AuthCtx { user: any; login: (e: string, p: string) => Promise<void>; logout: () => void; loading: boolean }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = localStorage.getItem('voxlink_admin_user');
    if (u) try { setUser(JSON.parse(u)); } catch {}
    setLoading(false);
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
