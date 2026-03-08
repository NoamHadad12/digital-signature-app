import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Wraps any route that requires the user to be authenticated.
// Any registered user can access protected routes — tenant isolation is
// enforced at the data layer (Firestore rules + clientId == uid filter).
// 'replace' prevents the login page from being pushed onto the browser history stack,
// so pressing Back after login doesn't loop back to /login.
const ProtectedRoute = ({ children }) => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
