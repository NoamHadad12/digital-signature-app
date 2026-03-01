import React, { useState } from 'react';
import { storage } from '../firebase';
import { ref, uploadBytes } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';

const UploadView = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      alert("Please select a PDF file first");
      return;
    }
    
    setUploading(true);
    setGeneratedLink(''); // Reset link on new upload
    setIsCopied(false); // Reset copied state on new upload
    const fileId = uuidv4();
    const storageRef = ref(storage, `pdfs/${fileId}.pdf`);

    try {
      await uploadBytes(storageRef, file);
      
      // Use window.location.origin to create a robust link for any environment
      const link = `${window.location.origin}/sign/${fileId}`;
      setGeneratedLink(link);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
    }, (err) => {
      console.error('Failed to copy link: ', err);
    });
  };

  return (
    <div style={{ padding: '40px', textAlign: 'center', maxWidth: '600px', margin: 'auto' }}>
      <h1>SignFlow</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>Upload a PDF document to generate a shareable signing link.</p>
      
      <div style={{ border: '2px dashed #ccc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={(e) => {
            setFile(e.target.files[0]);
            setGeneratedLink(''); // Clear link when a new file is selected
          }} 
          style={{ marginBottom: '10px' }}
        />
        <button 
          onClick={handleUpload} 
          disabled={uploading || !file}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: (uploading || !file) ? '#ccc' : '#007bff', 
            color: 'white', 
            border: 'none', 
            borderRadius: '5px', 
            cursor: (uploading || !file) ? 'not-allowed' : 'pointer' 
          }}
        >
          {uploading ? "Uploading..." : "Upload & Generate Link"}
        </button>
      </div>

      {generatedLink && (
        <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f8ff', borderRadius: '8px', border: '1px solid #bde0fe' }}>
          <p style={{ fontWeight: 'bold', margin: '0 0 10px 0' }}>Your link is ready:</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <input 
              type="text" 
              value={generatedLink} 
              readOnly 
              style={{ flexGrow: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            <button onClick={copyToClipboard} style={{ padding: '8px 12px' }}>
              {isCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadView;