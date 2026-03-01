import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Import the component files (we will create them in the next step)
import UploadView from './components/UploadView';
import SignerView from './components/SignerView';


function App() {
  return (
    // Wrap the app in BrowserRouter to enable navigation
    <BrowserRouter>
      <Routes>
        {/* The default route: Upload screen */}
        <Route path="/" element={<UploadView />} />
        
        {/* The signing route: Requires a dynamic document ID */}
        <Route path="/sign/:documentId" element={<SignerView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;