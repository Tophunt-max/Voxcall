import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api, req, getToken } from './api';

// ─── Cookie-Based Auth API ────────────────────────────────────────────────────
// SECURITY FIX: Admin session is now stored in an httpOnly + Secure +
// SameSite=Strict cookie set by the server. The JWT is NEVER accessible to
// JavaScript — eliminating the XSS token-theft vector entirely.
//
// The server sets/clears the cookie; this client only needs to include
// credentials in every fetch. The legacy Bearer-token flow (localStorage)
// is kept as a migration bridge: new logins go through cookie-auth, but
// existing sessions using localStorage still work until they expire.

const ADMIN_AUTH_API = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/admin-auth`
  : `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/admin-auth`;

async function cookieLogin(email: string, password: string): Promise<any> {
  const res = await fetch(`${ADMIN_AUTH_API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error || 'Login failed');
  }
  return res.json();
}

async function cookieGetSession(): Promise<any | null> {
  try {
    const res = await fetch(`${ADMIN_AUTH_API}/session`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json() as { user?: any };
    return data.user ?? null;
  } catch {
    return null;
  }
}

async function cookieLogout(): Promise<void> {
  try {
    await fetch(`${ADMIN_AUTH_API}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Best-effort — cookie cleared server-side even if network fails
  }
}

interface AuthCtx { user: any; login: (e: string, p: string) => Promise<void>; logout: () => void; loading: boolean }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try cookie-based session first (new secure flow)
    cookieGetSession().then((cookieUser) => {
      if (cookieUser) {
        setUser(cookieUser);
        setLoading(false);
        // Clean up any legacy localStorage tokens since cookie auth is active
        localStorage.removeItem('voxlink_admin_token');
        localStorage.removeItem('voxlink_admin_user');
        return;
      }

      // Fallback: check legacy localStorage session (migration bridge)
      const token = localStorage.getItem('voxlink_admin_token');
      const u = localStorage.getItem('voxlink_admin_user');
      if (!token || !u) {
        setLoading(false);
        return;
      }
      // Validate legacy token by calling the dashboard
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
    }).catch(() => {
      // Cookie check failed (network), fall back to localStorage
      const token = localStorage.getItem('voxlink_admin_token');
      const u = localStorage.getItem('voxlink_admin_user');
      if (token && u) {
        try { setUser(JSON.parse(u)); } catch {}
      }
      setLoading(false);
    });
  }, []);

  const login = async (email: string, password: string) => {
    // Use the new cookie-based login endpoint
    const data = await cookieLogin(email, password);
    const u = data.user;
    if (u.role !== 'admin') throw new Error('Not an admin account');
    setUser(u);
    // Also store in localStorage as a display-only cache (NOT used for auth)
    // so the user's name/avatar can render before the cookie session check.
    localStorage.setItem('voxlink_admin_user', JSON.stringify(u));
    // Clear any legacy auth token — no longer needed
    localStorage.removeItem('voxlink_admin_token');
  };

  const logout = () => {
    // Cookie-based logout: clears httpOnly cookie + invalidates server-side
    cookieLogout();
    // Also fire legacy Bearer logout for any old sessions still using it
    const legacyToken = getToken();
    if (legacyToken) {
      req('POST', '/auth/logout', {}).catch(() => {});
    }
    localStorage.removeItem('voxlink_admin_token');
    localStorage.removeItem('voxlink_admin_user');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout, loading }}>{children}</Ctx.Provider>;
}
