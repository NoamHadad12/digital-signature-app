import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield } from 'lucide-react';

// Firebase error code -> Hebrew user-friendly message mapping
const AUTH_ERRORS = {
  'auth/email-already-in-use':   'חשבון עם כתובת מייל זו כבר קיים.',
  'auth/invalid-email':          'אנא הזן כתובת מייל תקינה.',
  'auth/weak-password':          'הסיסמא חייבת להכיל לפחות 6 תווים.',
  'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור לאינטרנט.',
};

const SignUp = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate                = useNavigate();
  const { signup, currentUser } = useAuth();

  // Redirect authenticated users away from the registration page
  if (currentUser) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      return setError('הסיסמאות אינן תואמות.');
    }
    if (password.length < 6) {
      return setError('הסיסמא חייבת להכיל לפחות 6 תווים.');
    }

    setLoading(true);
    try {
      await signup(email, password);
      navigate('/');
    } catch (err) {
      setError(AUTH_ERRORS[err.code] || 'ההרשמה נכשלה. אנא נסה שנית.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 font-sans px-4">
      <div className="bg-white p-10 rounded-3xl shadow-xl w-full max-w-md border border-gray-100">

        {/* Brand header with Lucide icon */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-2xl mx-auto mb-4">
            <div className="w-6 h-6 text-blue-600">
              <Shield className="w-full h-full" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">SignFlow</h1>
          <p className="text-gray-500 mt-1 text-sm">Create your account</p>
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
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-gray-900
                         placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60
                       text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-sm transition-colors"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 font-semibold hover:text-blue-700">
            Sign in
          </Link>
        </p>

      </div>
    </div>
  );
};

export default SignUp;
