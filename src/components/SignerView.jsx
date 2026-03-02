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

// Return the display label for a given marker based on its subtype
const getFieldLabel = (marker) => {
  if (!marker.type || marker.type === 'signature') return 'Sign Here';
  if (marker.subtype === 'firstName') return 'First Name';
  if (marker.subtype === 'lastName') return 'Last Name';
  if (marker.subtype === 'date') return 'Date';
  return 'Field';
};

// Return the accent color for a given marker subtype
const getFieldColor = (subtype) => {
  const MAP = { signature: '#e53e3e', firstName: '#2563eb', lastName: '#7c3aed', date: '#059669' };
  return MAP[subtype] || '#e53e3e';
};

const SignerView = () => {
  const { documentId } = useParams();
  const [pdfUrl, setPdfUrl] = useState(null);
  // markers is an array of { page, nx, ny, nw, nh }
  const [markers, setMarkers] = useState([]);
  const [numPages, setNumPages] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState('');
  const [isSigned, setIsSigned] = useState(false);
  // Single global value per field subtype — changing one populates every marker of that subtype
  const [globalFields, setGlobalFields] = useState({
    firstName: '',
    lastName: '',
    date: new Date().toLocaleDateString('en-GB'), // Auto-filled as DD/MM/YYYY
  });
  const sigCanvas = useRef(null);

  // Helper: update one key inside globalFields
  const setField = (key, value) =>
    setGlobalFields((prev) => ({ ...prev, [key]: value }));

  // Clear the signature pad and reset the signed flag
  const handleClearSignature = () => {
    sigCanvas.current?.clear();
    setIsSigned(false);
  };

  useEffect(() => {
    // Track the object URL so the cleanup function can revoke it without a stale closure
    let objectUrl = null;

    const fetchDocument = async () => {
      if (!documentId) return;

      try {
        // Fetch placement metadata from Firestore
        const docRef = doc(db, 'documents', documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          // Support the new markers array and legacy single signatureCoords field
          if (Array.isArray(data.markers) && data.markers.length > 0) {
            setMarkers(data.markers);
            // Date is already pre-filled in globalFields state initialiser; nothing extra needed.
          } else if (data.signatureCoords) {
            setMarkers([data.signatureCoords]);
          }
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

  // Derive which field types are required based on the loaded markers
  const hasSignature = markers.some((m) => !m.type || m.type === 'signature');
  const hasFirstName = markers.some((m) => m.subtype === 'firstName');
  const hasLastName  = markers.some((m) => m.subtype === 'lastName');
  const hasDate      = markers.some((m) => m.subtype === 'date');

  // All required fields are complete — controls button state and status message
  const isFormReady =
    (!hasSignature || isSigned) &&
    (!hasFirstName || globalFields.firstName.trim() !== '') &&
    (!hasLastName  || globalFields.lastName.trim()  !== '') &&
    (!hasDate      || globalFields.date.trim()       !== '');

  const handleFinish = async () => {
    if (!isFormReady) return;
    setIsSubmitting(true);
    try {
      // Build a per-marker-index formValues map that the API expects
      const formValues = {};
      markers.forEach((m, idx) => {
        if (m.subtype === 'firstName') formValues[idx] = globalFields.firstName;
        else if (m.subtype === 'lastName') formValues[idx] = globalFields.lastName;
        else if (m.subtype === 'date')     formValues[idx] = globalFields.date;
      });

      const signatureData = hasSignature
        ? sigCanvas.current.getCanvas().toDataURL('image/png')
        : null;

      const response = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, signatureData, markers, formValues }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to sign the document.');

      setSignedPdfUrl(result.downloadUrl);
      setIsCompleted(true);
    } catch (error) {
      console.error('Error during the signing process:', error);
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
              // Preserve the global index so formValues keys remain consistent with the markers array
              const pageMarkers = markers
                .map((m, globalIdx) => ({ ...m, globalIdx }))
                .filter((m) => m.page === pageNumber);

              return (
                <div key={`page_${pageNumber}`} className="pdf-page-wrapper">
                  <Page
                    pageNumber={pageNumber}
                    width={Math.min(window.innerWidth - 40, 600)}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  {pageMarkers.map((marker) => {
                    const isSigMarker = !marker.type || marker.type === 'signature';
                    const color = getFieldColor(marker.subtype || 'signature');
                    const liveValue = !isSigMarker ? (globalFields[marker.subtype] || '') : '';
                    const isEmpty = !isSigMarker && !liveValue;

                    // Show a checkmark on signed boxes; live value or placeholder for text fields
                    let overlayText;
                    if (isSigMarker) {
                      overlayText = isSigned ? '✓' : 'Sign Here';
                    } else {
                      overlayText = liveValue || getFieldLabel(marker);
                    }

                    return (
                      <div
                        key={marker.globalIdx}
                        className="signature-marker"
                        style={{
                          left: `${marker.nx * 100}%`,
                          top: `${marker.ny * 100}%`,
                          width: `${marker.nw * 100}%`,
                          height: `${marker.nh * 100}%`,
                          borderColor: color,
                          backgroundColor: `${color}22`,
                          color,
                          fontStyle: isEmpty ? 'italic' : 'normal',
                          fontWeight: (!isSigMarker && liveValue) ? 700 : 600,
                        }}
                      >
                        {overlayText}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Document>
        </div>
      ) : (
        <p>Loading document from the cloud...</p>
      )}

      {/* Sticky footer with unified form panel — one card per field type */}
      <div className="action-footer">
        <div className="action-footer-inner">

          {markers.length > 0 && (
            <div className="form-panel">

              {/* Signature card */}
              {hasSignature && (
                <div className="form-card form-card--sig">
                  <div className="form-card-header" style={{ color: '#e53e3e', borderBottomColor: '#e53e3e1a' }}>
                    <span className="form-card-label">Signature</span>
                    <button className="form-clear-btn" onClick={handleClearSignature} title="Clear signature">↺</button>
                  </div>
                  <div className="form-card-body">
                    <div className="form-sig-wrap" style={{ borderColor: isSigned ? '#e53e3e55' : '#e0e0e0' }}>
                      <SignatureCanvas
                        ref={sigCanvas}
                        penColor="#1a1a1a"
                        onBegin={() => setIsSigned(true)}
                        canvasProps={{ className: 'sigCanvas' }}
                      />
                      {!isSigned && <div className="form-sig-placeholder">Sign here</div>}
                    </div>
                  </div>
                </div>
              )}

              {/* First Name card */}
              {hasFirstName && (
                <div className="form-card">
                  <div className="form-card-header" style={{ color: '#2563eb', borderBottomColor: '#2563eb1a' }}>
                    <span className="form-card-label">First Name</span>
                  </div>
                  <div className="form-card-body">
                    <input
                      className="form-card-input"
                      type="text"
                      placeholder="Enter first name"
                      value={globalFields.firstName}
                      onChange={(e) => setField('firstName', e.target.value)}
                      style={{ '--card-accent': '#2563eb' }}
                      dir="auto"
                    />
                  </div>
                </div>
              )}

              {/* Last Name card */}
              {hasLastName && (
                <div className="form-card">
                  <div className="form-card-header" style={{ color: '#7c3aed', borderBottomColor: '#7c3aed1a' }}>
                    <span className="form-card-label">Last Name</span>
                  </div>
                  <div className="form-card-body">
                    <input
                      className="form-card-input"
                      type="text"
                      placeholder="Enter last name"
                      value={globalFields.lastName}
                      onChange={(e) => setField('lastName', e.target.value)}
                      style={{ '--card-accent': '#7c3aed' }}
                      dir="auto"
                    />
                  </div>
                </div>
              )}

              {/* Date card */}
              {hasDate && (
                <div className="form-card">
                  <div className="form-card-header" style={{ color: '#059669', borderBottomColor: '#0596691a' }}>
                    <span className="form-card-label">Date</span>
                  </div>
                  <div className="form-card-body">
                    <input
                      className="form-card-input"
                      type="text"
                      placeholder="DD/MM/YYYY"
                      value={globalFields.date}
                      onChange={(e) => setField('date', e.target.value)}
                      style={{ '--card-accent': '#059669' }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Status line + action button */}
          <div className="footer-action-row">
            <p className={`action-footer-status${isFormReady ? ' ready' : ''}`}>
              {isFormReady ? '✓ Ready to complete' : 'Please fill all required fields'}
            </p>
            <button
              onClick={handleFinish}
              disabled={isSubmitting || !isFormReady}
              className="btn btn-success"
            >
              {isSubmitting ? 'Processing...' : 'Finish & Sign'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default SignerView;