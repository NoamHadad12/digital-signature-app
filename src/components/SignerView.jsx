import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { storage } from '../firebase';
import { ref, getDownloadURL } from 'firebase/storage';
import { Document, Page, pdfjs } from 'react-pdf';
import SignaturePad from 'react-signature-canvas';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getMarkerColor, getMarkerLabel, getMarkerKey, useWindowWidth } from '../utils/pdfHelpers';
import { fetchDocument, updateDocumentStatus } from '../services/dbService';
import { logAction } from '../utils/logger';

// Set the worker source from a reliable CDN to ensure compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Resolve issue with some versions of react-signature-canvas
const SignatureCanvas = SignaturePad.default || SignaturePad;

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
  // fieldValues is keyed by getMarkerKey() — one value shared across all markers with the same key
  const [fieldValues, setFieldValues] = useState({
    __date__: new Date().toLocaleDateString('en-GB'), // Pre-fill today as DD/MM/YYYY
  });
  const setFieldValue = (key, value) =>
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  const windowWidth = useWindowWidth();
  const sigCanvas = useRef(null);

  // Clear the signature pad and reset the signed flag
  const handleClearSignature = () => {
    sigCanvas.current?.clear();
    setIsSigned(false);
  };

  useEffect(() => {
    // Track the object URL so the cleanup function can revoke it without a stale closure
    let objectUrl = null;

    const loadDocument = async () => {
      if (!documentId) return;

      try {
        // Load markers from Firestore via dbService (supports new sub-collection + legacy formats)
        const result = await fetchDocument(documentId);
        if (result) {
          setMarkers(result.markers);
        }

        // Advance document status to 'opened' so the sender knows the signer viewed the document
        await updateDocumentStatus(documentId, 'opened').catch((err) =>
          console.warn('[status] Failed to mark document as opened:', err)
        );

        // Fetch the PDF as a blob to avoid CORS issues with react-pdf
        const fileRef = ref(storage, `pdfs/${documentId}.pdf`);
        let url = await getDownloadURL(fileRef);

        // Ensure the URL retrieves binary media content
        if (!url.includes('alt=media')) {
          url += (url.includes('?') ? '&' : '?') + 'alt=media';
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch the PDF file content.');

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);

      } catch (error) {
        console.error('Error fetching document:', error);
      }
    };

    loadDocument();

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

  // Build a deduplicated list of text-field cards to render in the footer
  // Each entry has: { key, label, color } — one card per unique key
  const textCards = [];
  const _seenKeys = new Set();
  markers.forEach((m) => {
    if (!m.type || m.type === 'signature') return;
    const key = getMarkerKey(m);
    if (!key || _seenKeys.has(key)) return;
    _seenKeys.add(key);
    textCards.push({ key, label: getMarkerLabel(m), color: getMarkerColor(m) });
  });

  // All required fields are filled — drives button enabled state and status text
  const isFormReady =
    (!hasSignature || isSigned) &&
    textCards.every(({ key }) => (fieldValues[key] || '').trim() !== '');

  const handleFinish = async () => {
    if (!isFormReady) return;
    setIsSubmitting(true);
    try {
      // Build a per-marker-index formValues map that the API expects
      const formValues = {};
      markers.forEach((m, idx) => {
        const key = getMarkerKey(m);
        if (key) formValues[idx] = fieldValues[key] || '';
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

      // Log the signing action
      await logAction('sign_doc', documentId, { signedPdfUrl: result.downloadUrl });

      // Advance status to 'signed' and persist the URL of the completed PDF
      await updateDocumentStatus(documentId, 'signed', { signedPdfUrl: result.downloadUrl });

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
                    width={Math.min(windowWidth - 40, 600)}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  {pageMarkers.map((marker) => {
                    const isSigMarker = !marker.type || marker.type === 'signature';
                    const color = getMarkerColor(marker);
                    const key = getMarkerKey(marker);
                    const liveValue = key ? (fieldValues[key] || '') : '';
                    const isEmpty = !isSigMarker && !liveValue;

                    // Show a checkmark once signed; live value or placeholder label for text fields
                    let overlayText;
                    if (isSigMarker) {
                      overlayText = isSigned ? '✓' : 'Sign Here';
                    } else {
                      overlayText = liveValue || getMarkerLabel(marker);
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

              {/* One input card per unique text field (dynamic, label-driven) */}
              {textCards.map(({ key, label, color }) => (
                <div className="form-card" key={key}>
                  <div className="form-card-header" style={{ color, borderBottomColor: `${color}1a` }}>
                    <span className="form-card-label">{label}</span>
                  </div>
                  <div className="form-card-body">
                    <input
                      className="form-card-input"
                      type="text"
                      placeholder={`Enter ${label.toLowerCase()}`}
                      value={fieldValues[key] || ''}
                      onChange={(e) => setFieldValue(key, e.target.value)}
                      dir="auto"
                    />
                  </div>
                </div>
              ))}

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