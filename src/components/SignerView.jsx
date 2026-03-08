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
import { FileText, CheckCircle2, Loader2, RotateCcw, Download } from 'lucide-react';

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

  // Success screen
  if (isCompleted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 font-sans">
        <div className="bg-white rounded-3xl shadow-xl p-10 max-w-md w-full text-center border border-gray-100">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <div className="w-8 h-8 text-emerald-600">
              <CheckCircle2 className="w-full h-full" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Document Signed!</h1>
          <p className="text-gray-500 text-sm mb-8">
            Thank you for completing the document. Your signature has been applied successfully.
          </p>
          <a
            href={signedPdfUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-6 py-3 rounded-xl shadow-sm transition-colors"
          >
            <div className="w-4 h-4">
              <Download className="w-full h-full" />
            </div>
            Download Your Copy
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans" style={{ paddingBottom: markers.length > 0 ? '220px' : '40px' }}>

      {/* Minimal branded header for the public signer */}
      <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <div className="w-4 h-4 text-white">
              <FileText className="w-full h-full" />
            </div>
          </div>
          <span className="text-lg font-bold text-gray-900 tracking-tight">SignFlow</span>
        </div>
        <span className="text-xs text-gray-400 hidden sm:block">Document Signing</span>
      </header>

      {/* PDF content area */}
      <main className="max-w-2xl mx-auto px-2 sm:px-4 py-6">
        {pdfUrl ? (
          <div className="flex flex-col items-center gap-2">
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
                  <div className="w-8 h-8 animate-spin text-blue-500">
                    <Loader2 className="w-full h-full" />
                  </div>
                  <span className="text-sm">Loading PDF...</span>
                </div>
              }
              error={<p className="text-red-500 text-sm text-center py-10">Failed to load PDF. Check CORS settings in Firebase.</p>}
            >
              {Array.from(new Array(numPages), (el, index) => {
                const pageNumber = index + 1;
                // Preserve global index so formValues keys stay consistent with markers array
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
                            left:        `${marker.nx * 100}%`,
                            top:         `${marker.ny * 100}%`,
                            width:       `${marker.nw * 100}%`,
                            height:      `${marker.nh * 100}%`,
                            borderColor: color,
                            backgroundColor: `${color}22`,
                            color,
                            fontStyle:   isEmpty ? 'italic' : 'normal',
                            fontWeight:  (!isSigMarker && liveValue) ? 700 : 600,
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
          <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
            <div className="w-8 h-8 animate-spin text-blue-500">
              <Loader2 className="w-full h-full" />
            </div>
            <span className="text-sm">Loading document from the cloud...</span>
          </div>
        )}
      </main>

      {/* Sticky footer with signature pad and text field inputs */}
      {markers.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-xl">
          <div className="max-w-3xl mx-auto px-4 py-3">

            {/* Scrollable card row - one card per field type */}
            <div className="flex gap-3 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'thin' }}>

              {/* Signature pad card */}
              {hasSignature && (
                <div className="flex-shrink-0 w-56 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-red-100 bg-red-50">
                    <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Signature</span>
                    <button
                      onClick={handleClearSignature}
                      title="Clear signature"
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <div className="w-4 h-4">
                        <RotateCcw className="w-full h-full" />
                      </div>
                    </button>
                  </div>
                  <div
                    className="relative overflow-hidden transition-colors"
                    style={{
                      height: '80px',
                      borderTop: isSigned ? '2px solid #e53e3e44' : undefined,
                    }}
                  >
                    <SignatureCanvas
                      ref={sigCanvas}
                      penColor="#1a1a1a"
                      onBegin={() => setIsSigned(true)}
                      canvasProps={{ className: 'sigCanvas' }}
                    />
                    {!isSigned && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-300 text-sm">
                        Sign here
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* One input card per unique text field type */}
              {textCards.map(({ key, label, color }) => (
                <div key={key} className="flex-shrink-0 w-44 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                  <div
                    className="px-3 py-2 border-b"
                    style={{ borderColor: `${color}22`, backgroundColor: `${color}0d` }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
                      {label}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    <input
                      type="text"
                      placeholder={`Enter ${label.toLowerCase()}`}
                      value={fieldValues[key] || ''}
                      onChange={(e) => setFieldValue(key, e.target.value)}
                      dir="auto"
                      className="w-full text-sm text-gray-800 bg-transparent outline-none placeholder-gray-300"
                    />
                  </div>
                </div>
              ))}

            </div>

            {/* Status line and action button */}
            <div className="flex items-center justify-between gap-4">
              <p className={`text-sm font-medium transition-colors ${isFormReady ? 'text-emerald-600' : 'text-gray-400'}`}>
                {isFormReady ? 'Ready to complete' : 'Please fill all required fields'}
              </p>
              <button
                onClick={handleFinish}
                disabled={isSubmitting || !isFormReady}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50
                           text-white text-sm font-semibold px-6 py-2.5 rounded-xl shadow-sm transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 animate-spin">
                      <Loader2 className="w-full h-full" />
                    </div>
                    Processing...
                  </>
                ) : (
                  <>
                    <div className="w-4 h-4">
                      <CheckCircle2 className="w-full h-full" />
                    </div>
                    Finish &amp; Sign
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default SignerView;