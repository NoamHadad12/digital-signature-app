// Import the core Firebase functionality
import { initializeApp } from "firebase/app";
// Import the Storage service to handle PDF uploads
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

// Pull the configuration from the hidden .env.local file
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

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

