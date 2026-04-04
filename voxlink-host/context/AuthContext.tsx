import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { setItem, getItem, removeItem, StorageKeys } from "@/utils/storage";
import { apiRequest, API } from "@/services/api";
import { registerForPushNotifications } from "@/services/NotificationService";

// Module-level logout callback so fetchFreshProfile can trigger auto-logout
// when the token has permanently expired (SESSION_EXPIRED).
let _onSessionExpired: (() => void) | null = null;

export type UserRole = "host" | "user";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  gender?: "male" | "female" | "other";
  country?: string;
  bio?: string;
  language?: string;
  coins: number;
  role: UserRole;
  isOnline?: boolean;
  rating?: number;
  totalCalls?: number;
  earnings?: number;
  isVerified?: boolean;
  kycStatus?: "pending" | "approved" | "rejected";
  is_guest?: boolean;
}

interface AuthState {
  user: UserProfile | null;
  isLoggedIn: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (user: UserProfile) => Promise<void>;
  loginWithToken: (token: string, user: UserProfile) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  updateEarnings: (newEarnings: number) => void;
  refreshProfile: () => Promise<void>;
  setOnlineStatus: (online: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchFreshProfile(): Promise<Partial<UserProfile> | null> {
  try {
    // Always fetch /api/user/me so the role is kept up-to-date.
    // This ensures that when an admin approves a pending host, the stored
    // "user" role is immediately upgraded to "host" on next app launch.
    const me = await apiRequest<any>("GET", "/api/user/me");
    if (!me) return null;

    const base: Partial<UserProfile> = {
      role: me.role,
      coins: me.coins,
      name: me.name,
      phone: me.phone,
      bio: me.bio,
      gender: me.gender,
      avatar: me.avatar_url,
    };

    // For approved hosts, also merge host-specific stats
    if (me.role === "host") {
      try {
        const host = await apiRequest<any>("GET", "/api/host/me");
        if (host) {
          return {
            ...base,
            isOnline: host.is_online,
            rating: host.rating,
            totalCalls: host.total_calls,
            earnings: host.total_earnings,
          };
        }
      } catch {}
    }

    return base;
  } catch (err: any) {
    if (err?.message === "SESSION_EXPIRED") {
      _onSessionExpired?.();
    }
    return null;
  }
}

async function syncPushToken(): Promise<void> {
  try {
    const token = await registerForPushNotifications();
    if (token) {
      await apiRequest("PATCH", "/api/user/me", { fcm_token: token });
    }
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoggedIn: false,
    isLoading: true,
  });

  const logoutRef = useRef<() => Promise<void>>();

  // Register session-expired callback so fetchFreshProfile can trigger auto-logout
  useEffect(() => {
    _onSessionExpired = () => { logoutRef.current?.(); };
    return () => { _onSessionExpired = null; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const user = await getItem<UserProfile>(StorageKeys.USER);
        if (user) {
          // Fetch fresh profile (including role) BEFORE clearing isLoading.
          // This prevents the router from redirecting to the wrong screen
          // based on a stale cached role (e.g. pending host who was just approved).
          const [freshProfile] = await Promise.all([
            fetchFreshProfile(),
            syncPushToken(),
          ]);
          const updatedUser = freshProfile ? { ...user, ...freshProfile } : user;
          if (freshProfile) await setItem(StorageKeys.USER, updatedUser);
          setState({ user: updatedUser, isLoggedIn: true, isLoading: false });
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setState((prev) => {
          if (!prev.isLoggedIn || !prev.user) return prev;
          fetchFreshProfile().then((freshProfile) => {
            if (freshProfile) {
              setState((p) => {
                if (!p.user) return p;
                const updated = { ...p.user, ...freshProfile };
                setItem(StorageKeys.USER, updated);
                return { ...p, user: updated };
              });
            }
          });
          return prev;
        });
      }
    });
    return () => sub.remove();
  }, []);

  const loginWithToken = useCallback(async (token: string, user: UserProfile) => {
    await Promise.all([
      setItem(StorageKeys.AUTH_TOKEN, token),
      setItem(StorageKeys.USER, user),
    ]);
    setState({ user, isLoggedIn: true, isLoading: false });
    syncPushToken().catch(() => {});
  }, []);

  const login = useCallback(async (user: UserProfile) => {
    await setItem(StorageKeys.USER, user);
    setState({ user, isLoggedIn: true, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    // Go offline on backend (correct param: is_online, not isOnline)
    try {
      await apiRequest("PATCH", "/api/host/status", { is_online: false });
    } catch {}
    // Clear FCM token so push notifications stop after logout
    try {
      await apiRequest("PATCH", "/api/user/me", { fcm_token: null });
    } catch {}
    await Promise.all([
      removeItem(StorageKeys.AUTH_TOKEN),
      removeItem(StorageKeys.USER),
    ]);
    setState({ user: null, isLoggedIn: false, isLoading: false });
  }, []);

  // Keep ref in sync so the session-expired callback always calls the latest logout
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    const backendUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) backendUpdates.name = updates.name;
    if (updates.bio !== undefined) backendUpdates.bio = updates.bio;
    if (updates.phone !== undefined) backendUpdates.phone = updates.phone;
    if (updates.gender !== undefined) backendUpdates.gender = updates.gender;
    if (updates.avatar !== undefined) backendUpdates.avatar_url = updates.avatar;
    if (updates.language !== undefined) backendUpdates.language = updates.language;
    if (Object.keys(backendUpdates).length > 0) {
      try {
        await apiRequest("PATCH", "/api/user/me", backendUpdates);
      } catch {}
    }
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, ...updates };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  const updateEarnings = useCallback((newEarnings: number) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, earnings: newEarnings };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    const freshProfile = await fetchFreshProfile();
    if (freshProfile) {
      setState((prev) => {
        if (!prev.user) return prev;
        const updated = { ...prev.user, ...freshProfile };
        setItem(StorageKeys.USER, updated);
        return { ...prev, user: updated };
      });
    }
  }, []);

  const setOnlineStatus = useCallback(async (online: boolean) => {
    // Backend expects is_online (snake_case), not isOnline
    try {
      await apiRequest("PATCH", "/api/host/status", { is_online: online });
    } catch {}
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, isOnline: online };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginWithToken,
        logout,
        updateProfile,
        updateEarnings,
        refreshProfile,
        setOnlineStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
