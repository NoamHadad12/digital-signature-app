import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';

import UploadView from './components/UploadView';
import SignerView from './components/SignerView';
import Login from './components/Login';
import ProtectedRoute from './components/ProtectedRoute';
// AuthProvider must wrap the entire app so every component can read auth state
import { AuthProvider } from './context/AuthContext';

function App() {
  return (
    <BrowserRouter>
      {/* AuthProvider sits inside BrowserRouter so Login.jsx can use useNavigate */}
      <AuthProvider>
        <div className="app-container">
          <Routes>
            {/* Public route — anyone with the link can sign a document */}
            <Route path="/sign/:documentId" element={<SignerView />} />

            {/* Public route — the login page */}
            <Route path="/login" element={<Login />} />

            {/* Protected route — only noam.hadad23@gmail.com can access the upload page */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <UploadView />
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