// Central runtime config — single source of truth for the backend base URL.
//
// The API base URL is injected at build time via EXPO_PUBLIC_API_URL (set in
// GitHub Actions for production, or a local .env for development — see
// .env.example). Previously each consumer (api.ts, SocketService.ts, and the
// in-call "beforeunload" beacons in audio-call/video-call) inlined its own
// fallback. Two of them fell back to a hardcoded worker URL while the call
// beacons fell back to an EMPTY string — so if the env var was ever missing
// the end-call beacon would POST to a relative `/api/...` path and silently
// fail. Centralising the resolution here removes that inconsistency.
//
// To point the app at a different backend, set EXPO_PUBLIC_API_URL — do not
// hardcode deployment URLs in individual files.

const DEFAULT_API_URL = "https://voxlink-api.ssunilkumarmohanta3.workers.dev";

const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim();

if (!ENV_API_URL && typeof __DEV__ !== "undefined" && __DEV__) {
  console.warn(
    "[config] EXPO_PUBLIC_API_URL is not set — falling back to the default backend. " +
      "Set EXPO_PUBLIC_API_URL in your environment to target your own deployment."
  );
}

// Normalised (no trailing slash) base URL used to build every request.
export const API_BASE_URL = (ENV_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
