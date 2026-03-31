import { useEffect, useRef } from "react";
import { Audio } from "expo-av";

type RingtoneType = "outgoing" | "incoming";

const RINGTONE_FILES: Record<RingtoneType, any> = {
  outgoing: require("@/assets/audio/ringtone_1.mp3"),
  incoming: require("@/assets/audio/ringtone_2.mp3"),
};

export function useRingtone(type: RingtoneType, active: boolean = true) {
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (!active) return;

    let isMounted = true;

    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: false,
        });

        const { sound } = await Audio.Sound.createAsync(RINGTONE_FILES[type], {
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
