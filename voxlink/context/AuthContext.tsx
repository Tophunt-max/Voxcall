import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import { setItem, getItem, removeItem, StorageKeys } from "@/utils/storage";
import { apiRequest, API } from "@/services/api";
import { registerForPushNotifications } from "@/services/NotificationService";

export type UserRole = "user" | "host";

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
  updateCoins: (newBalance: number) => void;
  refreshBalance: () => Promise<void>;
  switchRole: (role: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchFreshBalance(): Promise<number | null> {
  try {
    const bal = await apiRequest<{ coins: number }>("GET", "/api/coins/balance");
    return bal?.coins ?? null;
  } catch {
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

  useEffect(() => {
    (async () => {
      try {
        const user = await getItem<UserProfile>(StorageKeys.USER);
        if (user) {
          setState({ user, isLoggedIn: true, isLoading: false });
          // Silently refresh balance + push token in parallel
          const [freshCoins] = await Promise.all([
            fetchFreshBalance(),
            syncPushToken(),
          ]);
          if (freshCoins !== null) {
            setState((prev) => {
              if (!prev.user) return prev;
              const updated = { ...prev.user, coins: freshCoins };
              setItem(StorageKeys.USER, updated);
              return { ...prev, user: updated };
            });
          }
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  // Refresh balance when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setState((prev) => {
          if (!prev.isLoggedIn || !prev.user) return prev;
          fetchFreshBalance().then((freshCoins) => {
            if (freshCoins !== null) {
              setState((p) => {
                if (!p.user) return p;
                const updated = { ...p.user, coins: freshCoins };
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
    // Sync push token in background after login
    syncPushToken().catch(() => {});
  }, []);

  const login = useCallback(async (user: UserProfile) => {
    await setItem(StorageKeys.USER, user);
    setState({ user, isLoggedIn: true, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([
      removeItem(StorageKeys.AUTH_TOKEN),
      removeItem(StorageKeys.USER),
    ]);
    setState({ user: null, isLoggedIn: false, isLoading: false });
  }, []);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    // Map frontend fields to backend field names
    const backendUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) backendUpdates.name = updates.name;
    if (updates.bio !== undefined) backendUpdates.bio = updates.bio;
    if (updates.phone !== undefined) backendUpdates.phone = updates.phone;
    if (updates.gender !== undefined) backendUpdates.gender = updates.gender;
    if (updates.avatar !== undefined) backendUpdates.avatar_url = updates.avatar;
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

  const updateCoins = useCallback((newBalance: number) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, coins: newBalance };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  const refreshBalance = useCallback(async () => {
    const freshCoins = await fetchFreshBalance();
    if (freshCoins !== null) {
      setState((prev) => {
        if (!prev.user) return prev;
        const updated = { ...prev.user, coins: freshCoins };
        setItem(StorageKeys.USER, updated);
        return { ...prev, user: updated };
      });
    }
  }, []);

  const switchRole = useCallback(async (role: UserRole) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, role };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithToken, logout, updateProfile, updateCoins, refreshBalance, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
