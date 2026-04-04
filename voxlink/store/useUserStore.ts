// FIX #15: Zustand global store for frequently-accessed user state
// Replaces the pattern of reading coins/profile data from AuthContext on every render.
// Components that subscribe only to `coins` re-render ONLY when coins change — not
// when unrelated fields (avatar, bio, etc.) update. This eliminates unnecessary renders
// in HostCard, HeaderBar, and any component showing the coin balance.

import { create } from 'zustand';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'host' | 'admin';
  avatar_url: string | null;
  coins: number;
  gender: string | null;
  phone: string | null;
  bio: string | null;
}

interface UserStore {
  profile: UserProfile | null;
  coins: number;
  isLoggedIn: boolean;

  // Actions
  setProfile: (profile: UserProfile) => void;
  updateCoins: (coins: number) => void;
  deductCoins: (amount: number) => void;
  addCoins: (amount: number) => void;
  clearProfile: () => void;
}

export const useUserStore = create<UserStore>((set, get) => ({
  profile: null,
  coins: 0,
  isLoggedIn: false,

  setProfile: (profile) => set({
    profile,
    coins: profile.coins,
    isLoggedIn: true,
  }),

  updateCoins: (coins) => set((state) => ({
    coins,
    profile: state.profile ? { ...state.profile, coins } : null,
  })),

  deductCoins: (amount) => set((state) => {
    const newBalance = Math.max(0, state.coins - amount);
    return {
      coins: newBalance,
      profile: state.profile ? { ...state.profile, coins: newBalance } : null,
    };
  }),

  addCoins: (amount) => set((state) => {
    const newBalance = state.coins + amount;
    return {
      coins: newBalance,
      profile: state.profile ? { ...state.profile, coins: newBalance } : null,
    };
  }),

  clearProfile: () => set({
    profile: null,
    coins: 0,
    isLoggedIn: false,
  }),
}));

// Selector hooks for granular subscriptions (avoids over-rendering)
export const useCoins = () => useUserStore((s) => s.coins);
export const useUserProfile = () => useUserStore((s) => s.profile);
export const useIsLoggedIn = () => useUserStore((s) => s.isLoggedIn);
