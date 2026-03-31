import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

export interface FirestoreUser {
  uid: string;
  name: string;
  email: string;
  avatar: string;
  coins: number;
  role: "user" | "host";
  is_guest?: boolean;
  bio?: string;
  gender?: string;
  phone?: string;
  createdAt?: any;
  updatedAt?: any;
  loginMethod?: "google" | "guest";
}

export async function getFirestoreUser(uid: string): Promise<FirestoreUser | null> {
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() as FirestoreUser;
    return null;
  } catch (e) {
    console.warn("Firestore getUser error:", e);
    return null;
  }
}

export async function saveFirestoreUser(user: FirestoreUser): Promise<void> {
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        coins: user.coins,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...user,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn("Firestore saveUser error:", e);
  }
}

export async function updateFirestoreUser(
  uid: string,
  updates: Partial<FirestoreUser>
): Promise<void> {
  try {
    const ref = doc(db, "users", uid);
    await updateDoc(ref, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("Firestore updateUser error:", e);
  }
}
