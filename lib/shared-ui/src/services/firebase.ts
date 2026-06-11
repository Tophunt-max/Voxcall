import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
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
