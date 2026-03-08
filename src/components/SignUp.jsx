import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { Shield } from 'lucide-react';

// Firebase error code -> Hebrew user-friendly message mapping
const AUTH_ERRORS = {
  'auth/email-already-in-use':   'חשבון עם כתובת מייל זו כבר קיים.',
  'auth/invalid-email':          'אנא הזן כתובת מייל תקינה.',
  'auth/weak-password':          'הסיסמא חייבת להכיל לפחות 6 תווים.',
  'auth/network-request-failed': 'שגיאת רשת. בדוק את החיבור לאינטרנט.',
};

const INPUT_CLS = 'w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none';

const LABEL_CLS = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5';

const SignUp = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const navigate                  = useNavigate();
  const { signup, currentUser }   = useAuth();

  // Redirect authenticated users away from the registration page
  if (currentUser) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim()) {
      return setError('אנא הזן שם פרטי ושם משפחה.');
    }
    if (password !== confirm) {
      return setError('הסיסמאות אינן תואמות.');
    }

    // Enforce strong password: min 8 chars, at least one uppercase, one lowercase, one digit
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d\w\W]{8,}$/;
    if (!passwordRegex.test(password)) {
      return setError('Password must be at least 8 characters long and contain an uppercase letter, a lowercase letter, and a number.');
    }

    setLoading(true);
    try {
      const cred = await signup(email, password);
      // Persist the user's display name to Firestore immediately after account creation
      await setDoc(doc(db, 'users', cred.user.uid), {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        email,
        createdAt: new Date().toISOString(),
      });
      navigate('/');
    } catch (err) {
      setError(AUTH_ERRORS[err.code] || 'ההרשמה נכשלה. אנא נסה שנית.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-100">

        {/* Brand header with Lucide icon */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 flex items-center justify-center bg-blue-100 rounded-2xl mx-auto mb-4">
            <div className="w-6 h-6 text-blue-600">
              <Shield className="w-full h-full" />
            </div>
          </div>
          <h1 className="text-blue-600 font-bold text-3xl text-center mb-6">SignFlow</h1>
          <p className="text-gray-500 mt-1 text-sm">Create your account</p>
        </div>

        {/* Error banner - RTL for Hebrew messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 text-sm text-right" dir="rtl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* First Name + Last Name side by side */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className={LABEL_CLS}>First Name</label>
              <input
                type="text"
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Israel"
                className={INPUT_CLS}
              />
            </div>
            <div className="flex-1">
              <label className={LABEL_CLS}>Last Name</label>
              <input
                type="text"
                required
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Cohen"
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Email Address</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="israel@company.co.il"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 chars, 1 uppercase, 1 lowercase, 1 number"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Confirm Password</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              className={INPUT_CLS}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-all"
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
