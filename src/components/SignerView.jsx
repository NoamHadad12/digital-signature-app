import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { storage } from '../firebase';
import { ref, getDownloadURL } from 'firebase/storage';
import * as pdfjs from 'pdfjs-dist/build/pdf';

// Set the workerSrc for pdfjs to a specific version to avoid mismatches
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.worker.min.js`;

import { Document, Page } from 'react-pdf';
import SignaturePad from 'react-signature-canvas';

// Resolve issue with some versions of react-signature-canvas
const SignatureCanvas = SignaturePad.default || SignaturePad;

const SignerView = () => {
  console.log("!!! DEBUG: SignerView component is rendering !!!");

  const { documentId } = useParams();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState('');
  const [isSigned, setIsSigned] = useState(false);
  const sigCanvas = useRef(null);

  useEffect(() => {
    const fetchDocument = async () => {
      if (!documentId) return;

      try {
        console.log("Attempting to fetch PDF for ID:", documentId);
        const fileRef = ref(storage, `pdfs/${documentId}.pdf`);
        
        // Get the authenticated download URL
        let url = await getDownloadURL(fileRef);

        // Force the URL to retrieve the media content (binary)
        if (!url.includes('alt=media')) {
          url += (url.includes('?') ? '&' : '?') + 'alt=media';
        }

        // Fetch the PDF as a blob to bypass potential CORS issues with react-pdf
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch the PDF file content.');
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        console.log("SUCCESS! PDF Blob URL created:", blobUrl);
        setPdfUrl(blobUrl);

      } catch (error) {
        console.error("FIREBASE/FETCH ERROR:", error);
      }
    };

    fetchDocument();

    // Clean up the object URL when component unmounts
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [documentId]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const handleBeginStroke = () => {
    setIsSigned(true);
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

      // The API returns the direct download URL for the signed file
      setSignedPdfUrl(result.downloadUrl);
      setIsCompleted(true); 
      
    } catch (error) {
      console.error("Error during the signing process:", error);
      alert(`An error occurred: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success screen view
  if (isCompleted) {
    return (
      <div className="success-screen">
        <h1>✓ Document Signed and Sent!</h1>
        <p>Thank you for completing the document.</p>
        <a 
          href={signedPdfUrl} 
          download 
          target="_blank" 
          rel="noopener noreferrer"
          className="btn btn-primary"
        >
          Download Your Copy
        </a>
      </div>
    );
  }

  return (
    <div className="signer-view">
      <h1>Sign Document</h1>
      
      {pdfUrl ? (
        <div className="pdf-document-container">
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

      <div className="signature-area">
        <p style={{ textAlign: 'left', margin: '0 0 10px 5px', fontWeight: 'bold' }}>
          Signature
        </p>
        <div className="signature-pad-container">
          <SignatureCanvas 
            ref={sigCanvas}
            penColor='black'
            onBegin={handleBeginStroke}
            canvasProps={{ className: 'sigCanvas' }}
          />
          {!isSigned && <div className="signature-pad-placeholder">Sign Here</div>}
        </div>
      </div>

      <button 
        onClick={handleFinish}
        disabled={isSubmitting}
        className="btn btn-success"
        style={{ marginTop: '20px' }}
      >
        {isSubmitting ? 'Processing...' : 'Complete & Sign'}
      </button>
    </div>
  );
};

export default SignerView;