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

export const MOCK_HOSTS: Host[] = [
  {
    id: "host1",
    name: "Aria Chen",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=aria",
    bio: "Empathetic listener and life coach. I love meaningful conversations about life, relationships, and personal growth.",
    rating: 4.9,
    reviewCount: 312,
    languages: ["English", "Mandarin"],
    specialties: ["Life Coaching", "Relationships", "Personal Growth"],
    coinsPerMinute: 8,
    totalMinutes: 15420,
    isOnline: true,
    isTopRated: true,
    gender: "female",
    country: "Singapore",
  },
  {
    id: "host2",
    name: "Marcus Webb",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=marcus",
    bio: "Career counselor with 10+ years helping people find their purpose. Let's talk about your goals.",
    rating: 4.8,
    reviewCount: 248,
    languages: ["English", "French"],
    specialties: ["Career", "Business", "Motivation"],
    coinsPerMinute: 10,
    totalMinutes: 9800,
    isOnline: true,
    isTopRated: true,
    gender: "male",
    country: "Canada",
  },
  {
    id: "host3",
    name: "Sofia Rivera",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=sofia",
    bio: "Wellness advocate and meditation guide. Here to bring you peace and clarity.",
    rating: 4.7,
    reviewCount: 189,
    languages: ["English", "Spanish"],
    specialties: ["Wellness", "Meditation", "Stress Relief"],
    coinsPerMinute: 6,
    totalMinutes: 7300,
    isOnline: false,
    isTopRated: false,
    gender: "female",
    country: "Mexico",
  },
  {
    id: "host4",
    name: "James Park",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=james",
    bio: "Technology and startup advisor. Passionate about innovation and entrepreneurship.",
    rating: 4.6,
    reviewCount: 94,
    languages: ["English", "Korean"],
    specialties: ["Tech", "Startups", "Innovation"],
    coinsPerMinute: 12,
    totalMinutes: 3400,
    isOnline: true,
    isTopRated: false,
    gender: "male",
    country: "South Korea",
  },
  {
    id: "host5",
    name: "Priya Sharma",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=priya",
    bio: "Relationship expert and communication coach. Let's build deeper connections.",
    rating: 4.9,
    reviewCount: 421,
    languages: ["English", "Hindi"],
    specialties: ["Relationships", "Communication", "Self-love"],
    coinsPerMinute: 7,
    totalMinutes: 22100,
    isOnline: true,
    isTopRated: true,
    gender: "female",
    country: "India",
  },
  {
    id: "host6",
    name: "Lucas Müller",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=lucas",
    bio: "Sports psychologist and peak performance coach. Ready to unlock your potential.",
    rating: 4.5,
    reviewCount: 167,
    languages: ["English", "German"],
    specialties: ["Sports Psychology", "Performance", "Fitness"],
    coinsPerMinute: 9,
    totalMinutes: 5600,
    isOnline: false,
    isTopRated: false,
    gender: "male",
    country: "Germany",
  },
  {
    id: "host7",
    name: "Amina Hassan",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=amina",
    bio: "Creative writing mentor and storyteller. Let's explore worlds through words.",
    rating: 4.8,
    reviewCount: 203,
    languages: ["English", "Arabic"],
    specialties: ["Writing", "Creativity", "Storytelling"],
    coinsPerMinute: 7,
    totalMinutes: 8900,
    isOnline: true,
    isTopRated: false,
    gender: "female",
    country: "Egypt",
  },
  {
    id: "host8",
    name: "Takeshi Yamamoto",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=takeshi",
    bio: "Mindfulness teacher and Zen philosophy enthusiast. Find your inner calm.",
    rating: 4.9,
    reviewCount: 358,
    languages: ["English", "Japanese"],
    specialties: ["Mindfulness", "Zen", "Philosophy"],
    coinsPerMinute: 8,
    totalMinutes: 18700,
    isOnline: true,
    isTopRated: true,
    gender: "male",
    country: "Japan",
  },
];

export const COIN_PLANS: CoinPlan[] = [
  { id: "plan1", coins: 100, price: 0.99, currency: "USD" },
  { id: "plan2", coins: 500, price: 3.99, currency: "USD", isPopular: true },
  { id: "plan3", coins: 1200, price: 7.99, currency: "USD", bonus: 200 },
  { id: "plan4", coins: 3000, price: 17.99, currency: "USD", bonus: 500 },
  { id: "plan5", coins: 6000, price: 29.99, currency: "USD", bonus: 1500 },
];

export const MOCK_CALL_HISTORY: CallRecord[] = [
  {
    id: "cr1",
    hostName: "Aria Chen",
    hostAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=aria",
    type: "audio",
    duration: 1245,
    coinsSpent: 166,
    timestamp: Date.now() - 86400000,
    rating: 5,
  },
  {
    id: "cr2",
    hostName: "Marcus Webb",
    hostAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=marcus",
    type: "video",
    duration: 843,
    coinsSpent: 140,
    timestamp: Date.now() - 172800000,
    rating: 4,
  },
  {
    id: "cr3",
    hostName: "Priya Sharma",
    hostAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=priya",
    type: "audio",
    duration: 2100,
    coinsSpent: 245,
    timestamp: Date.now() - 259200000,
  },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    type: "promo",
    title: "Special Offer!",
    body: "Buy 500 coins and get 100 bonus coins. Limited time only!",
    timestamp: Date.now() - 3600000,
    isRead: false,
  },
  {
    id: "n2",
    type: "call",
    title: "Call Summary",
    body: "Your 20-minute call with Aria Chen has ended. 166 coins deducted.",
    timestamp: Date.now() - 86400000,
    isRead: false,
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=aria",
  },
  {
    id: "n3",
    type: "system",
    title: "Welcome to VoxLink!",
    body: "You've been gifted 50 coins to start your first conversation.",
    timestamp: Date.now() - 172800000,
    isRead: true,
  },
];

export const SPECIALTIES = [
  "All",
  "Life Coaching",
  "Relationships",
  "Career",
  "Wellness",
  "Meditation",
  "Tech",
  "Creativity",
  "Mindfulness",
  "Sports Psychology",
];

export const LANGUAGES = [
  "All",
  "English",
  "Spanish",
  "Mandarin",
  "Hindi",
  "French",
  "German",
  "Japanese",
  "Arabic",
  "Korean",
];

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
