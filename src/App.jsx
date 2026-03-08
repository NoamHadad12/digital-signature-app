import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';

import UploadView from './components/UploadView';
import SignerView from './components/SignerView';
import Login from './components/Login';
import SignUp from './components/SignUp';
import ProtectedRoute from './components/ProtectedRoute';
import AdminDashboard from './components/AdminDashboard';
// AuthProvider must wrap the entire app so every component can read auth state
import { AuthProvider } from './context/AuthContext';

function App() {
  return (
    <BrowserRouter>
      {/* AuthProvider sits inside BrowserRouter so Login.jsx can use useNavigate */}
      <AuthProvider>
        <div>
          <Routes>
            {/* Public route — anyone with the link can sign a document */}
            <Route path="/sign/:documentId" element={<SignerView />} />

            {/* Public routes — authentication pages */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />

            {/* Protected route — only noam.hadad23@gmail.com can access the upload page */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <UploadView />
                </ProtectedRoute>
              }
            />

            {/* Protected route — Admin Dashboard */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;