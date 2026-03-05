import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth, googleProvider } from '../firebase';
import { useAuth } from '../context/AuthContext';

const ALLOWED_EMAIL = 'noam.hadad23@gmail.com';

const Login = () => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { isAllowed } = useAuth();

  // If the user somehow reaches /login while already authenticated and allowed, send them home
  if (isAllowed) {
    navigate('/', { replace: true });
    return null;
  }

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      // Opens the Google OAuth popup — Firebase handles the token exchange automatically
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user?.email;

      // After sign-in, verify the Google account against the allowed address.
      // If it doesn't match, sign them back out immediately and show an error.
      if (email !== ALLOWED_EMAIL) {
        await auth.signOut();
        setError('Access denied. This application is restricted to authorized users only.');
        return;
      }

      // Allowed user — redirect to the admin (upload) page
      navigate('/');
    } catch (err) {
      setError('Sign-in failed. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-view">
      <div className="login-card">
        <h1 className="login-title">SignFlow</h1>
        <p className="login-subtitle">Admin Portal</p>

        {error && <p className="login-error">{error}</p>}

        <button
          className="btn btn-google"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          {/* Google "G" logo as an inline SVG — no external image dependency needed */}
          <svg className="google-icon" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
};

export default Login;
