// VoxLink Host — Auth Service
// Handles host-specific auth: login, register, KYC, become-host flow

import { setItem, getItem, removeItem, clearAll, StorageKeys } from '@/utils/storage';
import { UserProfile } from '@/context/AuthContext';
import { API, apiRequest } from './api';

export interface LoginPayload { email: string; password: string }
export interface RegisterPayload { name: string; email: string; phone: string; password: string }
export interface BecomeHostPayload {
  specialties: string[];
  languages: string[];
  bio: string;
  coinsPerMinute: number;
  gender: "male" | "female" | "other";
}
export interface KYCPayload {
  documentType: "aadhar" | "pan" | "passport" | "driving_license";
  documentNumber: string;
  frontImageUrl: string;
  backImageUrl?: string;
  selfieUrl: string;
}
export interface AuthResponse { success: boolean; user?: UserProfile; token?: string; error?: string }

function mapUser(u: any): UserProfile {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    coins: u.coins ?? 0,
    earnings: u.earnings ?? 0,
    role: "host",
    isOnline: u.is_online ?? false,
    avatar: u.avatar_url,
    bio: u.bio,
    gender: u.gender,
    rating: u.rating,
    totalCalls: u.total_calls,
    isVerified: u.is_verified,
    kycStatus: u.kyc_status,
  };
}

export async function loginWithEmail(payload: LoginPayload): Promise<AuthResponse> {
  try {
    const { token, user } = await API.login(payload.email, payload.password);
    const mapped = mapUser(user);
    await setItem(StorageKeys.AUTH_TOKEN, token);
    await setItem(StorageKeys.USER, mapped);
    return { success: true, user: mapped, token };
  } catch (err: any) {
    return { success: false, error: err.message || 'Login failed' };
  }
}

export async function registerUser(payload: RegisterPayload): Promise<AuthResponse> {
  try {
    const { token, user } = await API.register(payload.name, payload.email, payload.password, payload.phone);
    const mapped = mapUser(user);
    await setItem(StorageKeys.AUTH_TOKEN, token);
    await setItem(StorageKeys.USER, mapped);
    return { success: true, user: mapped, token };
  } catch (err: any) {
    return { success: false, error: err.message || 'Registration failed' };
  }
}

export async function becomeHost(payload: BecomeHostPayload): Promise<AuthResponse> {
  try {
    const user = await apiRequest<any>("POST", "/api/host/register", payload);
    const mapped = mapUser(user);
    await setItem(StorageKeys.USER, mapped);
    return { success: true, user: mapped };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to register as host' };
  }
}

export async function submitKYC(payload: KYCPayload): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest("POST", "/api/host/kyc", payload);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'KYC submission failed' };
  }
}

export async function getKYCStatus(): Promise<{ status: "pending" | "approved" | "rejected" | "not_submitted"; error?: string }> {
  try {
    const result = await apiRequest<{ status: "pending" | "approved" | "rejected" | "not_submitted" }>(
      "GET",
      "/api/host/kyc/status"
    );
    return { status: result?.status ?? "not_submitted" };
  } catch (err: any) {
    return { status: "not_submitted", error: err.message };
  }
}

export async function updateOnlineStatus(isOnline: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest("PATCH", "/api/host/status", { isOnline });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updatePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 6) return { success: false, error: 'New password must be at least 6 characters' };
  try {
    await apiRequest("PATCH", "/api/user/password", { oldPassword, newPassword });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    await apiRequest("DELETE", "/api/user/me");
  } catch {}
  await clearAll();
  return { success: true };
}

export async function refreshToken(): Promise<{ success: boolean; token?: string }> {
  const existing = await getItem<string>(StorageKeys.AUTH_TOKEN);
  if (!existing) return { success: false };
  return { success: true, token: existing };
}

export async function getStoredToken(): Promise<string | null> {
  return getItem<string>(StorageKeys.AUTH_TOKEN);
}
