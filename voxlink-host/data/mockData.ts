export { formatDuration, formatRelativeTime } from "@/utils/format";

export interface Host {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  rating: number;
  reviewCount: number;
  languages: string[];
  specialties: string[];
  coinsPerMinute: number;
  totalMinutes: number;
  isOnline: boolean;
  isTopRated: boolean;
  gender: "male" | "female";
  country: string;
}

export interface CoinPlan {
  id: string;
  coins: number;
  price: number;
  currency: string;
  bonus?: number;
  isPopular?: boolean;
}

export interface CallRecord {
  id: string;
  hostId?: string;
  hostName: string;
  hostAvatar: string;
  type: "audio" | "video";
  duration: number;
  coinsSpent: number;
  timestamp: number;
  rating?: number;
}

export interface Notification {
  id: string;
  type: "call" | "message" | "promo" | "system";
  title: string;
  body: string;
  timestamp: number;
  isRead: boolean;
  avatar?: string;
}
