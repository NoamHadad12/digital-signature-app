import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Wraps any route that requires the user to be authenticated.
// Any registered user can access protected routes — tenant isolation is
// enforced at the data layer (Firestore rules + clientId == uid filter).
// 'replace' prevents the login page from being pushed onto the browser history stack,
// so pressing Back after login doesn't loop back to /login.
const ProtectedRoute = ({ children }) => {
  const { currentUser, userProfile, loading, logout } = useAuth();

  if (loading) return <div>Loading...</div>;

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Block all unapproved users (Deny by Default)
  if (userProfile?.status !== 'approved') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-100">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Account Pending</h2>
          <p className="text-gray-600 mb-6">
            Your account is waiting for administrator approval. Please check back later.
          </p>
          <button
            onClick={logout}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;
