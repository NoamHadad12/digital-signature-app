import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Firebase error code -> Hebrew user-friendly message mapping
const AUTH_ERRORS = {
  'auth/user-not-found':         'לא נמצא חשבון עם כתובת מייל זו.',
  'auth/wrong-password':         'סיסמה שגויה. אנא נסה שנית.',
  'auth/invalid-credential':     'כתובת מייל או סיסמה שגויים.',
  'auth/invalid-email':          'אנא הזן כתובת מייל תקינה.',
  'auth/too-many-requests':      'יותר מדי ניסיונות כושלים. אנא נסה שוב מאוחר יותר.',
  'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור לאינטרנט.',
};

const Login = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate                = useNavigate();
  const { login, currentUser }  = useAuth();

  // Redirect authenticated users away from the login page immediately
  if (currentUser) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(AUTH_ERRORS[err.code] || 'הכניסה נכשלה. אנא נסה שנית.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-100">

        {/* Brand header with shared logo asset */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="SignFlow logo"
            className="w-48 sm:w-56 h-auto mx-auto object-contain"
          />
          <p className="text-gray-500 mt-4 text-sm font-medium">Sign in to your account</p>
        </div>

        {/* Error banner - RTL for Hebrew messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm text-right" dir="rtl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{' '}
          <Link to="/signup" className="text-blue-600 font-semibold hover:text-blue-700">
            Create one
          </Link>
        </p>

      </div>
    </div>
  );
};


export default Login;
