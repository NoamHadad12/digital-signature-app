import React, { useState } from 'react';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid'; // Need to install: npm install uuid

const UploadView = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) return alert("Please select a PDF file first");
    
    setUploading(true);
    const fileId = uuidv4();
    const storageRef = ref(storage, `pdfs/${fileId}.pdf`);

    try {
      // Upload the file to Firebase Storage
      await uploadBytes(storageRef, file);
      
      // Ensure the generated URL includes the /sign/ route path
      const link = `http://localhost:3000/sign/${fileId}`;
      alert(`Upload complete! Your link: ${link}`);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h1>SignFlow</h1>
      <input 
        type="file" 
        accept="application/pdf" 
        onChange={(e) => setFile(e.target.files[0])} 
      />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? "Uploading..." : "Upload & Generate Link"}
      </button>
    </div>
  );
};

export default UploadView;