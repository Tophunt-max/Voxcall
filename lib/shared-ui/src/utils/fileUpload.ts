import { Platform } from "react-native";

/**
 * Cross-platform helper to append a media file to FormData.
 * On native: uses the React Native file object { uri, name, type }.
 * On web: fetches the URI as a Blob (expo-image-picker returns blob/data URLs).
 */
export async function appendFileToFormData(
  formData: FormData,
  fieldName: string,
  uri: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  if (Platform.OS === "web") {
    let lastError: unknown;
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });
      formData.append(fieldName, file);
      return;
    } catch (err) {
      lastError = err;
    }
    // Fallback: try appending as blob directly
    try {
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Failed to fetch file (fallback): ${response.status}`);
      const blob = await response.blob();
      formData.append(fieldName, blob, fileName);
      return;
    } catch (err) {
      lastError = err;
    }
    throw new Error(`Could not prepare file for upload: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  } else {
    formData.append(fieldName, { uri, name: fileName, type: mimeType } as any);
  }
}

/**
 * Cross-platform Share. Uses Web Share API on web, React Native Share on native.
 * Falls back to clipboard copy if Web Share API is unavailable.
 */
export async function crossShare(options: {
  message: string;
  title?: string;
  url?: string;
}): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: options.title,
          text: options.message,
          url: options.url,
        });
        return;
      }
    } catch {}
    // Fallback: copy to clipboard
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(options.url ?? options.message);
        return;
      }
    } catch {}
    return;
  }
  // Native
  const { Share } = require("react-native");
  await Share.share({ message: options.message, title: options.title });
}
