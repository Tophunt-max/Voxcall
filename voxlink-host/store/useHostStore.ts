// FIX #15: Zustand global store for Host App
// Isolates frequently-updated host-specific state (earnings, online status, coin balance)
// so components subscribing to a single field don't re-render on unrelated changes.

import { create } from 'zustand';

interface HostProfile {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  hourly_rate: number;
  coins: number;
  is_online: boolean;
  total_earnings_cents: number;
  rating: number;
  total_reviews: number;
}

interface HostStore {
  profile: HostProfile | null;
  coins: number;
  isOnline: boolean;
  pendingEarnings: number;

  // Actions
  setProfile: (profile: HostProfile) => void;
  setOnline: (online: boolean) => void;
  updateCoins: (coins: number) => void;
  addEarnings: (cents: number) => void;
  clearProfile: () => void;
}

export const useHostStore = create<HostStore>((set) => ({
  profile: null,
  coins: 0,
  isOnline: false,
  pendingEarnings: 0,

  setProfile: (profile) => set({
    profile,
    coins: profile.coins,
    isOnline: profile.is_online,
  }),

  setOnline: (online) => set((state) => ({
    isOnline: online,
    profile: state.profile ? { ...state.profile, is_online: online } : null,
  })),

  updateCoins: (coins) => set((state) => ({
    coins,
    profile: state.profile ? { ...state.profile, coins } : null,
  })),

  addEarnings: (cents) => set((state) => ({
    pendingEarnings: state.pendingEarnings + cents,
    profile: state.profile
      ? { ...state.profile, total_earnings_cents: state.profile.total_earnings_cents + cents }
      : null,
  })),

  clearProfile: () => set({
    profile: null,
    coins: 0,
    isOnline: false,
    pendingEarnings: 0,
  }),
}));

// Granular selector hooks to prevent over-rendering
export const useHostCoins = () => useHostStore((s) => s.coins);
export const useHostIsOnline = () => useHostStore((s) => s.isOnline);
export const useHostProfile = () => useHostStore((s) => s.profile);
