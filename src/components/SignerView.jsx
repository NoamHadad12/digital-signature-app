import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { storage } from '../firebase';
import { ref, getDownloadURL } from 'firebase/storage';
import { Document, Page, pdfjs } from 'react-pdf';

import SignaturePad from 'react-signature-canvas';
const SignatureCanvas = SignaturePad.default || SignaturePad;

// --- IMPORTANT: VITE-FRIENDLY WORKER CONFIGURATION ---
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const SignerView = () => {
  const { documentId } = useParams();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState('');
  
  // Initialize ref with null for better practice with DOM elements/components
  const sigCanvas = useRef(null);

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        const fileRef = ref(storage, `pdfs/${documentId}.pdf`);
        const url = await getDownloadURL(fileRef);
        setPdfUrl(url);
      } catch (error) {
        console.error("Error fetching PDF from storage:", error);
      }
    };
    fetchDocument();
  }, [documentId]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const handleFinish = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      alert("Please provide a signature first.");
      return;
    }

    setIsSubmitting(true);

    try {
      const signatureData = sigCanvas.current.getCanvas().toDataURL('image/png');

      const response = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, signatureData }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to sign the document.');
      }

      // Get the download URL for the newly signed PDF
      const signedFileRef = ref(storage, result.downloadUrl);
      const downloadUrl = await getDownloadURL(signedFileRef);
      setSignedPdfUrl(downloadUrl);
      setIsCompleted(true); // Set completion state to true
      
    } catch (error) {
      console.error("Error during the signing process:", error);
      alert(`An error occurred: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success screen component
  if (isCompleted) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
        <h1 style={{ color: '#28a745' }}>✓ Document Signed and Sent!</h1>
        <p>Thank you for completing the document.</p>
        <a 
          href={signedPdfUrl} 
          download 
          target="_blank" 
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            marginTop: '20px',
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Download Your Copy
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
      <h1>Sign Document</h1>
      
      {pdfUrl ? (
        <div style={{ border: '1px solid #ccc', marginBottom: '20px', maxWidth: '100%', overflow: 'auto' }}>
          <Document 
            file={pdfUrl} 
            onLoadSuccess={onDocumentLoadSuccess}
            loading={<div>Loading PDF...</div>}
            error={<div>Failed to load PDF. Check CORS settings in Firebase.</div>}
          >
            {Array.from(new Array(numPages), (el, index) => (
              <Page 
                key={`page_${index + 1}`} 
                pageNumber={index + 1} 
                width={Math.min(window.innerWidth - 40, 600)} 
                renderTextLayer={false} 
                renderAnnotationLayer={false} 
              />
            ))}
          </Document>
        </div>
      ) : (
        <p>Loading document from the cloud...</p>
      )}

      {/* Enhanced Signature Box */}
      <div style={{ 
        marginTop: '20px', 
        width: '504px', 
        border: '1px solid #ccc', 
        borderRadius: '8px', 
        padding: '10px', 
        boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
        backgroundColor: '#fff'
      }}>
        <p style={{ 
          textAlign: 'left', 
          margin: '0 0 10px 5px', 
          fontWeight: 'bold', 
          color: '#333' 
        }}>
          Signature
        </p>
        <div style={{ border: '2px solid #e0e0e0', borderRadius: '4px' }}>
          <SignatureCanvas 
            ref={sigCanvas}
            penColor='black'
            canvasProps={{ width: 500, height: 200, className: 'sigCanvas' }} 
          />
        </div>
      </div>

      <button 
        onClick={handleFinish}
        disabled={isSubmitting}
        style={{ 
          marginTop: '20px', 
          padding: '15px 30px', 
          backgroundColor: isSubmitting ? '#ccc' : '#28a745', 
          color: 'white', 
          border: 'none', 
          borderRadius: '5px', 
          cursor: isSubmitting ? 'not-allowed' : 'pointer' 
        }}
      >
        {isSubmitting ? 'Processing...' : 'Complete & Sign'}
      </button>
    </div>
  );
};

export default SignerView;