import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../firebase';

// Create the context object — components consume this via useAuth()
const AuthContext = createContext(null);

// Custom hook for easy access to the auth context from any component
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  // currentUser: the Firebase user object (with uid), or null if not signed in
  // loading: true while Firebase resolves the initial auth state on page load
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChanged fires immediately with the current user, then again
    // every time the user signs in or out. Returns an unsubscribe function.
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    // Clean up the listener when the component unmounts
    return unsubscribe;
  }, []);

  // Sign in with email and password
  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  // Register a new account with email and password
  const signup = (email, password) =>
    createUserWithEmailAndPassword(auth, email, password);

  // Sign the current user out of Firebase
  const logout = () => signOut(auth);

  const value = { currentUser, login, signup, logout, loading };

  // Render nothing until Firebase resolves the initial auth state.
  // This prevents a flash of the login page when the user refreshes while logged in.
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
