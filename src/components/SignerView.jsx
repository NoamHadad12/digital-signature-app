import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { storage, db } from '../firebase';
import { ref, getDownloadURL } from 'firebase/storage';
import { doc, getDoc } from 'firebase/firestore';
import { Document, Page, pdfjs } from 'react-pdf';
import SignaturePad from 'react-signature-canvas';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set the worker source from a reliable CDN to ensure compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Resolve issue with some versions of react-signature-canvas
const SignatureCanvas = SignaturePad.default || SignaturePad;

const SignerView = () => {
  const { documentId } = useParams();
  const [pdfUrl, setPdfUrl] = useState(null);
  const [signatureCoords, setSignatureCoords] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState('');
  const [isSigned, setIsSigned] = useState(false);
  const sigCanvas = useRef(null);

  useEffect(() => {
    // Track the object URL so the cleanup function can revoke it without a stale closure
    let objectUrl = null;

    const fetchDocument = async () => {
      if (!documentId) return;

      try {
        // Fetch placement metadata from Firestore
        const docRef = doc(db, "documents", documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().signatureCoords) {
          setSignatureCoords(docSnap.data().signatureCoords);
        }

        const fileRef = ref(storage, `pdfs/${documentId}.pdf`);

        // Get the authenticated download URL
        let url = await getDownloadURL(fileRef);

        // Ensure the URL retrieves binary media content
        if (!url.includes('alt=media')) {
          url += (url.includes('?') ? '&' : '?') + 'alt=media';
        }

        // Fetch the PDF as a blob to avoid CORS issues with react-pdf
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch the PDF file content.');
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);

      } catch (error) {
        console.error("Error fetching document:", error);
      }
    };

    fetchDocument();

    // Revoke the object URL on unmount using the local variable, not the stale state value
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
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
        body: JSON.stringify({ 
          documentId, 
          signatureData,
          signatureCoords
        }),
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
        <div className="pdf-document-container" style={{ textAlign: 'center' }}>
          <Document 
            file={pdfUrl} 
            onLoadSuccess={onDocumentLoadSuccess}
            loading={<div>Loading PDF...</div>}
            error={<div>Failed to load PDF. Check CORS settings in Firebase.</div>}
          >
            {Array.from(new Array(numPages), (el, index) => {
              const pageNumber = index + 1;
              return (
                <div key={`page_${pageNumber}`} className="pdf-page-wrapper">
                  <Page 
                    pageNumber={pageNumber} 
                    width={Math.min(window.innerWidth - 40, 600)} 
                    renderTextLayer={false} 
                    renderAnnotationLayer={false} 
                  />
                  {/* Overlay the bounding box so the signer knows exactly where to sign */}
                  {signatureCoords && signatureCoords.page === pageNumber && (
                    <div 
                      className="signature-marker" 
                      style={{
                        left: `${signatureCoords.nx * 100}%`,
                        top: `${signatureCoords.ny * 100}%`,
                        width: `${(signatureCoords.nw || 0.3) * 100}%`,
                        height: `${(signatureCoords.nh || 0.08) * 100}%`,
                      }}
                    >
                      Sign Here
                    </div>
                  )}
                </div>
              );
            })}
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