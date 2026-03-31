import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD46BXKhAh8Gh8Zu7XvM1J-wSLs8g4lLRc",
  authDomain: "connectme-80909.firebaseapp.com",
  projectId: "connectme-80909",
  storageBucket: "connectme-80909.firebasestorage.app",
  messagingSenderId: "128169786412",
  appId: "1:128169786412:web:11cf3612a7f4520f98e589",
  measurementId: "G-PEEM2KM9QZ",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
