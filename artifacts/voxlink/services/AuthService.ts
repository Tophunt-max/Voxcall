// VoxLink Auth Service
// Centralized authentication logic: login, register, OTP, password reset

import { setItem, getItem, removeItem, clearAll, StorageKeys } from "@/utils/storage";
import { UserProfile } from "@/context/AuthContext";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  token?: string;
  error?: string;
}

const MOCK_DELAY = 800;
function delay(ms = MOCK_DELAY) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeToken() {
  return `vl_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export async function loginWithEmail(payload: LoginPayload): Promise<AuthResponse> {
  await delay();
  const { email, password } = payload;

  // Mock: any valid-looking credentials succeed
  if (!email || !password || password.length < 4) {
    return { success: false, error: "Invalid email or password" };
  }

  const existing = await getItem<UserProfile>(StorageKeys.USER);
  const user: UserProfile = existing ?? {
    id: `u_${Date.now()}`,
    name: email.split("@")[0],
    email,
    coins: 120,
    role: "user",
    isOnline: true,
  };

  const token = makeToken();
  await setItem(StorageKeys.AUTH_TOKEN, token);
  await setItem(StorageKeys.USER, user);
  return { success: true, user, token };
}

export async function registerUser(payload: RegisterPayload): Promise<AuthResponse> {
  await delay();
  const { name, email, phone } = payload;

  if (!name || !email || !phone) {
    return { success: false, error: "All fields are required" };
  }

  const user: UserProfile = {
    id: `u_${Date.now()}`,
    name,
    email,
    phone,
    coins: 50, // Welcome bonus
    role: "user",
    isOnline: true,
  };

  const token = makeToken();
  await setItem(StorageKeys.AUTH_TOKEN, token);
  await setItem(StorageKeys.USER, user);
  return { success: true, user, token };
}

export async function sendOTP(phone: string): Promise<{ success: boolean; otp?: string; error?: string }> {
  await delay(600);
  if (!phone || phone.length < 7) {
    return { success: false, error: "Invalid phone number" };
  }
  // In production, this calls the API. For mock, return a fixed OTP.
  return { success: true, otp: "123456" };
}

export async function verifyOTP(phone: string, otp: string): Promise<{ success: boolean; error?: string }> {
  await delay(500);
  // Mock: accept "123456" or any 6-digit code in dev
  if (otp === "123456" || otp.length === 6) {
    return { success: true };
  }
  return { success: false, error: "Incorrect OTP. Please try again." };
}

export async function sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
  await delay(700);
  if (!email.includes("@")) {
    return { success: false, error: "Invalid email address" };
  }
  return { success: true };
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  await delay(600);
  if (newPassword.length < 6) {
    return { success: false, error: "Password too short" };
  }
  return { success: true };
}

export async function updatePassword(
  oldPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  await delay(600);
  if (newPassword.length < 6) {
    return { success: false, error: "New password must be at least 6 characters" };
  }
  return { success: true };
}

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
  await delay(1000);
  await clearAll();
  return { success: true };
}

export async function refreshToken(): Promise<{ success: boolean; token?: string }> {
  await delay(300);
  const existing = await getItem<string>(StorageKeys.AUTH_TOKEN);
  if (!existing) return { success: false };
  const newToken = makeToken();
  await setItem(StorageKeys.AUTH_TOKEN, newToken);
  return { success: true, token: newToken };
}

export async function getStoredToken(): Promise<string | null> {
  return getItem<string>(StorageKeys.AUTH_TOKEN);
}
