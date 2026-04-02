import { Image } from 'react-native';

const AVATAR_SOURCES = [
  require("@/assets/images/avatar_male.png"),
  require("@/assets/images/avatar_female.png"),
  require("@/assets/images/avatar_placeholder.png"),
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
  "avatar_male",
  "avatar_female",
  "avatar_placeholder",
];

export function getRandomAvatarKey(): string {
  return AVATAR_LOCAL_KEYS[Math.floor(Math.random() * AVATAR_LOCAL_KEYS.length)];
}
