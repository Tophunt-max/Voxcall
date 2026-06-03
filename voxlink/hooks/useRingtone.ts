import { useRingtone as useRingtoneBase } from "@workspace/shared-ui/hooks";

type RingtoneType = "outgoing" | "incoming";

const RINGTONE_MODULES: Record<RingtoneType, any> = {
  outgoing: require("@/assets/audio/ringtone_1.mp3"),
  incoming: require("@/assets/audio/ringtone_2.mp3"),
};

export function useRingtone(type: RingtoneType, active: boolean = true) {
  return useRingtoneBase(type, active, RINGTONE_MODULES);
}
