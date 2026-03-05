// Import the core Firebase functionality
import { initializeApp } from "firebase/app";
// Import the Storage service to handle PDF uploads
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";
// Import Firebase Auth and the Google sign-in provider
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Pull the configuration from .env.local (locally) or Vercel Environment Variables (in production).
// Every VITE_* variable must be defined, otherwise Firebase will silently fail
// and surface as auth/configuration-not-found during Google Sign-In.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Guard: fail fast with a descriptive error if any required variable is missing.
// This shows up in the browser console and is much easier to debug than the
// generic auth/configuration-not-found error from Firebase.
const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const missingKeys = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);
if (missingKeys.length > 0) {
  throw new Error(
    `[firebase.js] Missing environment variables: ${missingKeys.map((k) => `VITE_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`).join(', ')}. ` +
    'Add them to .env.local for local dev, or to Vercel → Project Settings → Environment Variables for production.'
  );
}

// Initialize the Firebase app instance
const app = initializeApp(firebaseConfig);

// Initialize Analytics if supported by the browser
isSupported().then((supported) => {
  if (supported) {
    getAnalytics(app);
  }
});

// Initialize Cloud Storage and Firestore and export them
export const storage = getStorage(app);
export const db = getFirestore(app);
// Export the auth instance and Google provider for use across the app
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

