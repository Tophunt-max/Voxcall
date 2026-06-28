import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

// Firebase web config. These are PUBLIC identifiers (shipped in every web
// client), not secrets — so we hardcode the project's values as a fallback.
// Env vars (EXPO_PUBLIC_FIREBASE_*) still take precedence when provided at
// build time, so other environments can override without a code change.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "AIzaSyD46BXKhAh8Gh8Zu7XvM1J-wSLs8g4lLRc",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "connectme-80909.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "connectme-80909",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "connectme-80909.firebasestorage.app",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "128169786412",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:128169786412:web:11cf3612a7f4520f98e589",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-PEEM2KM9QZ",
};

const hasConfig = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const db: Firestore = getFirestore(app);

// getAuth() throws auth/invalid-api-key synchronously when apiKey is empty.
// Only call it when we actually have valid credentials. The app uses
// JWT-based API auth; Firebase auth is only needed for Google Sign-In on web.
let auth: Auth;
if (hasConfig) {
  auth = getAuth(app);
} else {
  console.warn(
    "[Firebase] EXPO_PUBLIC_FIREBASE_* env vars not set — " +
      "Firebase Auth/FCM unavailable. Google Sign-In will not work. " +
      "Set these env vars and rebuild to enable full functionality."
  );
  auth = null as unknown as Auth;
}

export { db, auth };
export default app;
