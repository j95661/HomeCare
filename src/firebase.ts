import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
} from "firebase/firestore";
import { getMessaging, type Messaging } from "firebase/messaging";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const functions = getFunctions(app);

const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: useEmulators ? memoryLocalCache() : persistentLocalCache(),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = createDb();

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export function messagingOrNull(): Messaging | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  try {
    return getMessaging(app);
  } catch {
    return null;
  }
}

export { app };
