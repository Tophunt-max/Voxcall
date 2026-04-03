import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { setItem, getItem, removeItem, StorageKeys } from "@/utils/storage";
import { apiRequest, API } from "@/services/api";
import { registerForPushNotifications, notifyLowCoins } from "@/services/NotificationService";

const LOW_COINS_THRESHOLD = 10;

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

async function fetchFreshBalance(): Promise<{ coins: number | null; tokenExpired: boolean }> {
  try {
    const bal = await apiRequest<{ coins: number }>("GET", "/api/coins/balance");
    return { coins: bal?.coins ?? null, tokenExpired: false };
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    const tokenExpired = msg.includes("unauthorized") || msg.includes("401") || msg.includes("invalid token") || msg.includes("token expired");
    return { coins: null, tokenExpired };
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
          const [balResult] = await Promise.all([
            fetchFreshBalance(),
            syncPushToken(),
          ]);
          // If token is expired and refresh also failed, auto-logout
          if (balResult.tokenExpired) {
            await Promise.all([
              removeItem(StorageKeys.AUTH_TOKEN),
              removeItem(StorageKeys.USER),
            ]);
            setState({ user: null, isLoggedIn: false, isLoading: false });
            return;
          }
          if (balResult.coins !== null) {
            setState((prev) => {
              if (!prev.user) return prev;
              const updated = { ...prev.user, coins: balResult.coins! };
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

  // Refresh balance when app comes back to foreground; also detect token expiry
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setState((prev) => {
          if (!prev.isLoggedIn || !prev.user) return prev;
          fetchFreshBalance().then((balResult) => {
            if (balResult.tokenExpired) {
              // Token expired while app was backgrounded — auto-logout
              Promise.all([
                removeItem(StorageKeys.AUTH_TOKEN),
                removeItem(StorageKeys.USER),
              ]).then(() => {
                setState({ user: null, isLoggedIn: false, isLoading: false });
              });
              return;
            }
            if (balResult.coins !== null) {
              setState((p) => {
                if (!p.user) return p;
                const updated = { ...p.user, coins: balResult.coins! };
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
    // Clear FCM token on backend before logging out so we stop receiving push notifications
    try {
      await apiRequest("PATCH", "/api/user/me", { fcm_token: null });
    } catch {}
    // Notify backend of logout (stateless JWT, best-effort)
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
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

  const lowCoinAlertedRef = useRef(false);

  const updateCoins = useCallback((newBalance: number) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const prevCoins = prev.user.coins ?? 0;
      // Trigger low coins alert once when balance drops to threshold
      if (
        newBalance > 0 &&
        newBalance <= LOW_COINS_THRESHOLD &&
        prevCoins > LOW_COINS_THRESHOLD &&
        !lowCoinAlertedRef.current
      ) {
        lowCoinAlertedRef.current = true;
        notifyLowCoins(newBalance);
        setTimeout(() => { lowCoinAlertedRef.current = false; }, 60000);
      }
      const updated = { ...prev.user, coins: newBalance };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  const refreshBalance = useCallback(async () => {
    const balResult = await fetchFreshBalance();
    if (balResult.coins !== null) {
      setState((prev) => {
        if (!prev.user) return prev;
        const updated = { ...prev.user, coins: balResult.coins! };
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
