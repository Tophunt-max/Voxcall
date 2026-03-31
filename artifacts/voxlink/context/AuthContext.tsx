import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { setItem, getItem, removeItem, StorageKeys } from "@/utils/storage";

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
  switchRole: (role: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    })();
  }, []);

  const loginWithToken = useCallback(async (token: string, user: UserProfile) => {
    await Promise.all([
      setItem(StorageKeys.AUTH_TOKEN, token),
      setItem(StorageKeys.USER, user),
    ]);
    setState({ user, isLoggedIn: true, isLoading: false });
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

  const switchRole = useCallback(async (role: UserRole) => {
    setState((prev) => {
      if (!prev.user) return prev;
      const updated = { ...prev.user, role };
      setItem(StorageKeys.USER, updated);
      return { ...prev, user: updated };
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithToken, logout, updateProfile, updateCoins, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
