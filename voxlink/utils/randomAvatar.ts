import { Image } from 'react-native';

const AVATAR_SOURCES = [
  require("@/assets/avatars/avatar_1.png"),
  require("@/assets/avatars/avatar_2.png"),
  require("@/assets/avatars/avatar_3.png"),
  require("@/assets/avatars/avatar_4.png"),
  require("@/assets/avatars/avatar_5.png"),
  require("@/assets/avatars/avatar_6.png"),
];

export function getRandomAvatarSource() {
  const idx = Math.floor(Math.random() * AVATAR_SOURCES.length);
  return AVATAR_SOURCES[idx];
}

export function getRandomAvatarIndex(): number {
  return Math.floor(Math.random() * AVATAR_SOURCES.length);
}

export function getAvatarSourceByIndex(idx: number) {
  return AVATAR_SOURCES[idx % AVATAR_SOURCES.length];
}

export function getRandomAvatarUri(): string {
  const src = getRandomAvatarSource();
  try {
    const resolved = Image.resolveAssetSource(src);
    return resolved?.uri ?? '';
  } catch {
    return '';
  }
}

export const AVATAR_LOCAL_KEYS = [
  "avatar_1",
  "avatar_2",
  "avatar_3",
  "avatar_4",
  "avatar_5",
  "avatar_6",
];

export function getRandomAvatarKey(): string {
  return AVATAR_LOCAL_KEYS[Math.floor(Math.random() * AVATAR_LOCAL_KEYS.length)];
}
