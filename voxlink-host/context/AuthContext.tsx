import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import { setItem, getItem, removeItem, StorageKeys } from "@/utils/storage";
import { apiRequest, API } from "@/services/api";
import { registerForPushNotifications } from "@/services/NotificationService";

export type UserRole = "host";

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
    const profile = await apiRequest<{ earnings: number; rating: number; totalCalls: number; isOnline: boolean }>(
      "GET",
      "/api/host/profile"
    );
    return profile ?? null;
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
          const hostUser: UserProfile = { ...user, role: "host" };
          setState({ user: hostUser, isLoggedIn: true, isLoading: false });
          const [freshProfile] = await Promise.all([
            fetchFreshProfile(),
            syncPushToken(),
          ]);
          if (freshProfile) {
            setState((prev) => {
              if (!prev.user) return prev;
              const updated = { ...prev.user, ...freshProfile };
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
    const hostUser: UserProfile = { ...user, role: "host" };
    await Promise.all([
      setItem(StorageKeys.AUTH_TOKEN, token),
      setItem(StorageKeys.USER, hostUser),
    ]);
    setState({ user: hostUser, isLoggedIn: true, isLoading: false });
    syncPushToken().catch(() => {});
  }, []);

  const login = useCallback(async (user: UserProfile) => {
    const hostUser: UserProfile = { ...user, role: "host" };
    await setItem(StorageKeys.USER, hostUser);
    setState({ user: hostUser, isLoggedIn: true, isLoading: false });
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
