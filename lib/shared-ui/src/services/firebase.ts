import Constants from "expo-constants";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

type FirebaseConfigKey =
  | "apiKey"
  | "authDomain"
  | "projectId"
  | "storageBucket"
  | "messagingSenderId"
  | "appId"
  | "measurementId";

type FirebaseExtraConfig = Partial<Record<FirebaseConfigKey, string>>;

const FIREBASE_DEFAULTS: Record<FirebaseConfigKey, string> = {
  apiKey: "AIzaSyD46BXKhAh8Gh8Zu7XvM1J-wSLs8g4lLRc",
  authDomain: "connectme-80909.firebaseapp.com",
  projectId: "connectme-80909",
  storageBucket: "connectme-80909.firebasestorage.app",
  messagingSenderId: "128169786412",
  appId: "1:128169786412:web:11cf3612a7f4520f98e589",
  measurementId: "G-PEEM2KM9QZ",
};

const FIREBASE_ENV_BY_KEY: Record<FirebaseConfigKey, string> = {
  apiKey: "EXPO_PUBLIC_FIREBASE_API_KEY",
  authDomain: "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "EXPO_PUBLIC_FIREBASE_APP_ID",
  measurementId: "EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID",
};

const extraFirebase = ((
  Constants.expoConfig?.extra as { firebase?: FirebaseExtraConfig } | undefined
)?.firebase ?? {}) as FirebaseExtraConfig;

const readFirebaseValue = (key: FirebaseConfigKey): string => {
  const envValue = process.env[FIREBASE_ENV_BY_KEY[key]];
  return envValue || extraFirebase[key] || FIREBASE_DEFAULTS[key];
};

const firebaseConfig = {
  apiKey: readFirebaseValue("apiKey"),
  authDomain: readFirebaseValue("authDomain"),
  projectId: readFirebaseValue("projectId"),
  storageBucket: readFirebaseValue("storageBucket"),
  messagingSenderId: readFirebaseValue("messagingSenderId"),
  appId: readFirebaseValue("appId"),
  measurementId: readFirebaseValue("measurementId"),
};

const missingRequiredConfig = ["apiKey", "projectId", "appId"].filter(
  (key) => !firebaseConfig[key as FirebaseConfigKey],
);

const hasConfig = missingRequiredConfig.length === 0;

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
    `[Firebase] Missing required config values: ${missingRequiredConfig.join(
      ", ",
    )}. Set the matching EXPO_PUBLIC_FIREBASE_* env vars or expo.extra.firebase values and rebuild to enable Firebase Auth/FCM.`,
  );
  auth = null as unknown as Auth;
}

export { db, auth };
export default app;
