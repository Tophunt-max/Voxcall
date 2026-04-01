const AVATARS = [
  require("@/assets/avatars/avatar_1.png"),
  require("@/assets/avatars/avatar_2.png"),
  require("@/assets/avatars/avatar_3.png"),
  require("@/assets/avatars/avatar_4.png"),
  require("@/assets/avatars/avatar_5.png"),
  require("@/assets/avatars/avatar_6.png"),
];

export function getRandomAvatarSource() {
  const idx = Math.floor(Math.random() * AVATARS.length);
  return AVATARS[idx];
}

export function getRandomAvatarIndex(): number {
  return Math.floor(Math.random() * AVATARS.length);
}

export function getAvatarSourceByIndex(idx: number) {
  return AVATARS[idx % AVATARS.length];
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
  const keys = AVATAR_LOCAL_KEYS;
  return keys[Math.floor(Math.random() * keys.length)];
}
