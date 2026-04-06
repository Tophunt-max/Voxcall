import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";

type RingtoneType = "outgoing" | "incoming";

const RINGTONE_MODULES: Record<RingtoneType, any> = {
  outgoing: require("@/assets/audio/ringtone_1.mp3"),
  incoming: require("@/assets/audio/ringtone_2.mp3"),
};

function stopWebAudio(el: HTMLAudioElement | null) {
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
    el.src = "";
    el.load();
  } catch {}
}

// Resolve the playable URI for web from an Expo module reference.
// Expo's web bundler (Metro/webpack) resolves require() for media to a string URL.
// If it's not a string (shouldn't happen on web), fall back to null.
function resolveWebUri(mod: any): string | null {
  if (typeof mod === "string") return mod;
  if (mod?.uri) return mod.uri;
  if (mod?.default && typeof mod.default === "string") return mod.default;
  return null;
}

export function useRingtone(type: RingtoneType, active: boolean = true) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!active) return;

    if (Platform.OS === "web") {
      // On web, use native HTMLAudioElement for reliable stop.
      // expo-av's stopAsync() can fail silently in browsers.
      const uri = resolveWebUri(RINGTONE_MODULES[type]);
      if (uri) {
        try {
          const audio = new window.Audio(uri);
          audio.loop = true;
          audio.volume = 1.0;
          webAudioRef.current = audio;
          audio.play().catch(() => {});
        } catch (e) {
          console.warn("useRingtone web: failed to play:", e);
        }
      }

      return () => {
        stopWebAudio(webAudioRef.current);
        webAudioRef.current = null;
      };
    }

    // Native (iOS / Android) — use expo-av
    let isMounted = true;

    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: false,
        });

        const { sound } = await Audio.Sound.createAsync(RINGTONE_MODULES[type], {
          isLooping: true,
          volume: 1.0,
          shouldPlay: true,
        });

        if (!isMounted) {
          await sound.unloadAsync();
          return;
        }

        soundRef.current = sound;
      } catch (e) {
        console.warn("useRingtone: failed to load sound:", e);
      }
    };

    load();

    return () => {
      isMounted = false;
      if (soundRef.current) {
        soundRef.current.stopAsync().catch(() => {});
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, [active, type]);

  const stop = async () => {
    if (Platform.OS === "web") {
      stopWebAudio(webAudioRef.current);
      webAudioRef.current = null;
      return;
    }
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
  };

  return { stop };
}
