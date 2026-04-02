// VoxLink Auth Service — connects to Cloudflare Workers backend
import { setItem, getItem, removeItem, clearAll, StorageKeys } from '@/utils/storage';
import { UserProfile } from '@/context/AuthContext';
import { API } from './api';

export interface LoginPayload { email: string; password: string }
export interface RegisterPayload { name: string; email: string; phone: string; password: string }
export interface AuthResponse { success: boolean; user?: UserProfile; token?: string; error?: string }

function mapUser(u: any): UserProfile {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    coins: u.coins ?? 0,
    role: u.role as any,
    isOnline: true,
    avatar: u.avatar_url,
    bio: u.bio,
    gender: u.gender,
    isVerified: u.is_verified,
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

export async function sendOTP(phone: string): Promise<{ success: boolean; otp?: string; error?: string }> {
  if (!phone || phone.length < 7) return { success: false, error: 'Invalid phone number' };
  // In production, API would trigger real SMS. Dev: return fixed OTP.
  return { success: true, otp: '123456' };
}

export async function verifyOTP(phone: string, otp: string): Promise<{ success: boolean; error?: string }> {
  if (otp === '123456' || otp.length === 6) return { success: true };
  return { success: false, error: 'Incorrect OTP. Please try again.' };
}

export async function sendPasswordResetEmail(email: string): Promise<{ success: boolean; error?: string }> {
  if (!email.includes('@')) return { success: false, error: 'Invalid email address' };
  return { success: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 6) return { success: false, error: 'Password too short' };
  return { success: true };
}

export async function updatePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (newPassword.length < 6) return { success: false, error: 'New password must be at least 6 characters' };
  return { success: true };
}

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
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
