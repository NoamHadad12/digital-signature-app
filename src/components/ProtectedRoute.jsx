import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Wraps any route that requires the user to be authenticated AND allowed.
// If the check fails, the user is redirected to /login.
// 'replace' prevents the login page from being pushed onto the browser history stack,
// so pressing Back after login doesn't loop back to /login.
const ProtectedRoute = ({ children }) => {
  const { currentUser, isAllowed } = useAuth();

  if (!currentUser || !isAllowed) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
