const base = require("./app.json");

const firebaseDefaults = {
  apiKey: "AIzaSyD46BXKhAh8Gh8Zu7XvM1J-wSLs8g4lLRc",
  authDomain: "connectme-80909.firebaseapp.com",
  projectId: "connectme-80909",
  storageBucket: "connectme-80909.firebasestorage.app",
  messagingSenderId: "128169786412",
  appId: "1:128169786412:web:11cf3612a7f4520f98e589",
  measurementId: "G-PEEM2KM9QZ",
};

const firebase = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || firebaseDefaults.apiKey,
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || firebaseDefaults.authDomain,
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || firebaseDefaults.projectId,
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    firebaseDefaults.storageBucket,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    firebaseDefaults.messagingSenderId,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || firebaseDefaults.appId,
  measurementId:
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ||
    firebaseDefaults.measurementId,
};

const origin = process.env.EXPO_PUBLIC_SITE_URL || "https://voxcall.pages.dev/";

base.expo.plugins = base.expo.plugins.map((plugin) => {
  if (Array.isArray(plugin) && plugin[0] === "expo-router") {
    return [plugin[0], { ...plugin[1], origin }];
  }
  return plugin;
});

base.expo.extra = {
  ...(base.expo.extra || {}),
  firebase: {
    ...((base.expo.extra && base.expo.extra.firebase) || {}),
    ...firebase,
  },
};

module.exports = base;
