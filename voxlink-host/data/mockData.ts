export { formatDuration, formatRelativeTime } from "@/utils/format";

export interface HostProfile {
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
  earnings: number;
  kycStatus: "pending" | "approved" | "rejected";
  isVerified: boolean;
}

export interface CallRecord {
  id: string;
  userId?: string;
  userName: string;
  userAvatar: string;
  type: "audio" | "video";
  duration: number;
  coinsEarned: number;
  timestamp: number;
  rating?: number;
  userRatedHost?: boolean;
}

export interface WithdrawalRecord {
  id: string;
  amount: number;
  method: string;
  accountDetails: string;
  status: "pending" | "approved" | "rejected";
  timestamp: number;
  orderId: string;
}

export interface Notification {
  id: string;
  type: "call" | "message" | "earning" | "system" | "review";
  title: string;
  body: string;
  timestamp: number;
  isRead: boolean;
  avatar?: string;
}
