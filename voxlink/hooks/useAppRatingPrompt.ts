// Smart app rating prompt — shows after a positive call experience.
// Triggers after:
//   - User gives 4+ stars to a host call
//   - User has completed at least 3 calls total
//   - At least 7 days since last prompt
//   - User hasn't already rated (tracked in AsyncStorage)
//
// Uses expo-store-review (which wraps the native in-app review API on both
// iOS and Android). On web, opens the Play Store page in a new tab.

import { useCallback, useRef } from 'react';
import { Platform, Linking } from 'react-native';
import { getItem, setItem } from '@/utils/storage';

const RATING_PROMPT_KEY = 'app_rating_last_prompt';
const RATING_DONE_KEY = 'app_rating_done';
const MIN_CALLS_BEFORE_PROMPT = 3;
const MIN_DAYS_BETWEEN_PROMPTS = 7;

// Play Store URL (Android) — replace with actual package name
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.voxlink.app';

export function useAppRatingPrompt() {
  const hasCheckedRef = useRef(false);

  const maybeShowRatingPrompt = useCallback(async (starsGiven: number, totalCallsCompleted: number) => {
    // Only trigger on 4+ star ratings
    if (starsGiven < 4) return;
    // Need at least 3 calls
    if (totalCallsCompleted < MIN_CALLS_BEFORE_PROMPT) return;
    // Already shown recently?
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    try {
      const done = await getItem<string>(RATING_DONE_KEY);
      if (done === 'true') return;

      const lastPrompt = await getItem<string>(RATING_PROMPT_KEY);
      if (lastPrompt) {
        const daysSince = (Date.now() - parseInt(lastPrompt)) / (1000 * 60 * 60 * 24);
        if (daysSince < MIN_DAYS_BETWEEN_PROMPTS) return;
      }

      // Mark as prompted
      await setItem(RATING_PROMPT_KEY, String(Date.now()));

      if (Platform.OS === 'web') {
        // On web, we can't do in-app review — skip silently
        return;
      }

      // Use expo-store-review for native in-app review
      try {
        const StoreReview = require('expo-store-review');
        const isAvailable = await StoreReview.isAvailableAsync();
        if (isAvailable) {
          // Small delay so it doesn't interrupt the rating UI
          setTimeout(async () => {
            try {
              await StoreReview.requestReview();
              await setItem(RATING_DONE_KEY, 'true');
            } catch (e) {
              console.warn('[AppRating] requestReview failed:', e);
            }
          }, 2000);
        }
      } catch (e) {
        // expo-store-review not available (dev build without it)
        console.warn('[AppRating] StoreReview not available:', e);
      }
    } catch (e) {
      console.warn('[AppRating] prompt check failed:', e);
    } finally {
      // Reset so next call can check again
      setTimeout(() => { hasCheckedRef.current = false; }, 60000);
    }
  }, []);

  const openStoreForRating = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        window.open(PLAY_STORE_URL, '_blank');
      } else {
        const StoreReview = require('expo-store-review');
        const storeUrl = await StoreReview.storeUrl();
        if (storeUrl) {
          await Linking.openURL(storeUrl);
        } else {
          await Linking.openURL(PLAY_STORE_URL);
        }
      }
      await setItem(RATING_DONE_KEY, 'true');
    } catch (e) {
      console.warn('[AppRating] openStore failed:', e);
      try { await Linking.openURL(PLAY_STORE_URL); } catch {}
    }
  }, []);

  return { maybeShowRatingPrompt, openStoreForRating };
}
