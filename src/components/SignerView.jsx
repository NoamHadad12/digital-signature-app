import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { storage, db, auth } from '../firebase';
import { ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { Document, Page, pdfjs } from 'react-pdf';
import SignaturePad from 'react-signature-canvas';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getMarkerColor, getMarkerLabel, useWindowWidth } from '../utils/pdfHelpers';
import { fetchDocument } from '../services/dbService';
import { useNotification } from '../context/NotificationContext';

// Set the worker source from a reliable CDN to ensure compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Resolve issue with some versions of react-signature-canvas
const SignatureCanvas = SignaturePad.default || SignaturePad;

// ---------------------------------------------------------------------------
// getInputKey
// Returns the key used inside fieldValues for a given marker.
// Each non-date, non-signature marker gets a UNIQUE position-based key so
// labels never collide (important for AI-generated fields that may share a
// label or have no label at all).
// ---------------------------------------------------------------------------
const getInputKey = (marker, idx) => {
  if (!marker.type || marker.type === 'signature') return null;
  if (marker.type === 'date') return '__date__';
  // All other types (customText, text, legacy) get a unique slot per position.
  return `__field_${idx}__`;
};

const storageCompat = {
  refFromURL: (url) => ({
    delete: () => deleteObject(ref(storage, url)),
  }),
};

const SignerView = () => {
  const { documentId } = useParams();
  const { showToast } = useNotification();
  const [pdfUrl, setPdfUrl] = useState(null);
  // markers is an array of { page, nx, ny, nw, nh }
  const [markers, setMarkers] = useState([]);
  const [numPages, setNumPages] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isAlreadySigned, setIsAlreadySigned] = useState(false);
  const [missingFile, setMissingFile] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState('');
  const [originalPdfUrl, setOriginalPdfUrl] = useState('');
  const [cleanupNotice, setCleanupNotice] = useState('');
  const [isSigned, setIsSigned] = useState(false);
  const [signMode, setSignMode] = useState('draw'); // 'draw' | 'upload'
  const [uploadedSignature, setUploadedSignature] = useState(null);

  // fieldValues stores typed text, keyed by getInputKey(marker, idx).
  // Date fields share '__date__'; every other text field has a unique index key.
  const [fieldValues, setFieldValues] = useState({
    __date__: new Date().toLocaleDateString('en-GB'), // Pre-fill today as DD/MM/YYYY
  });
  const setFieldValue = (key, value) =>
    setFieldValues((prev) => ({ ...prev, [key]: value }));

  const windowWidth = useWindowWidth();
  const sigCanvas = useRef(null);

  // --- 2FA state -----------------------------------------------------------
  const [signerPhone, setSignerPhone] = useState('');
  const [is2FARequired, setIs2FARequired] = useState(false);
  // 'idle' | 'sending' | 'waiting' | 'verifying' | 'verified'
  const [twoFAState, setTwoFAState] = useState('idle');
  const [otpCode, setOtpCode] = useState('');
  const confirmationRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);
  // -------------------------------------------------------------------------

  const handleClearSignature = () => {
    if (signMode === 'draw') {
      sigCanvas.current?.clear();
    } else {
      setUploadedSignature(null);
    }
    setIsSigned(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/jpg')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const MAX_SIZE = 500;
          
          if (width > MAX_SIZE || height > MAX_SIZE) {
            if (width > height) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            } else {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Generate an optimized PNG data URL
          setUploadedSignature(canvas.toDataURL('image/png'));
          setIsSigned(true);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    // Track the object URL so the cleanup function can revoke it without a stale closure
    let objectUrl = null;

    const loadDocument = async () => {
      if (!documentId) return;

      try {
        // Load markers and document metadata from Firestore
        const result = await fetchDocument(documentId);
        if (result) {
          // Block access if this document has already been signed — link is single-use
          if ((result.data?.status || '').toLowerCase() === 'signed') {
            setIsAlreadySigned(true);
            return;
          }

          setMarkers(result.markers);
          setOriginalPdfUrl(result.data?.originalPdfUrl || result.data?.fileUrl || '');

          // Enforce 2FA if the admin stored a signer phone number
          const phone = result.data?.signerPhone?.trim() || '';
          if (phone) {
            setSignerPhone(phone);
            setIs2FARequired(true);
          }
        }

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
        if (error?.code === 'storage/object-not-found') {
          setMissingFile(true);
        }
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

  // ---------------------------------------------------------------------------
  // 2FA helpers — SMS OTP via Firebase Phone Auth + invisible reCAPTCHA
  // ---------------------------------------------------------------------------

  // Show only last 4 digits of the phone number for display
  const maskedPhone = signerPhone.length > 4
    ? '*'.repeat(signerPhone.length - 4) + signerPhone.slice(-4)
    : signerPhone;

  // Standardize phone number format strictly to E.164
  const formatPhoneNumber = (phone) => {
    let digits = (phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) {
      digits = '972' + digits.substring(1);
    } else if (digits.startsWith('5')) {
      digits = '972' + digits;
    }
    return '+' + digits;
  };

  // 1. Complete Component Isolation - Nuclear Cleanup
  const nuclearRecaptchaCleanup = () => {
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch { /* ignore */ }
      window.recaptchaVerifier = null;
    }
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = null;
    }

    const el = document.getElementById('recaptcha-container');
    if (el) {
      const clone = el.cloneNode(false);
      el.parentNode.replaceChild(clone, el);
    }
  };

  // Robust singleton reCAPTCHA initialization
  const renderRecaptcha = () => {
    nuclearRecaptchaCleanup();

    const verifier = new RecaptchaVerifier(
      auth,
      'recaptcha-container',
      {
        size: 'invisible',
        callback: () => { /* solved */ },
        'expired-callback': () => {
          nuclearRecaptchaCleanup();
        }
      }
    );

    window.recaptchaVerifier = verifier;
    recaptchaVerifierRef.current = verifier;
    return verifier;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      nuclearRecaptchaCleanup();
    };
  }, []);

  const handleSendCode = async () => {
    // Atomic execution check
    if (twoFAState === 'sending') return;

    setTwoFAState('sending');
    try {
      const formattedPhone = formatPhoneNumber(signerPhone);
      console.log(`[Auth Debug] Attempting SMS to: ${formattedPhone}`);

      // Ensure cleanup before EVERY attempt
      const verifier = renderRecaptcha();

      const confirmation = await signInWithPhoneNumber(
        auth,
        formattedPhone,
        verifier
      );
      
      // Log confirmationResult to console to check for silent failures
      console.log('[Auth Debug] confirmationResult:', confirmation);
      
      confirmationRef.current = confirmation;
      setTwoFAState('waiting');
      showToast('קוד אימות נשלח לטלפון שלך', 'success');
    } catch (err) {
      console.error('[Auth Debug] 2FA send error:', err);
      let errorMsg = 'שגיאה בשליחת קוד האימות. בדוק את מספר הטלפון ונסה שוב.';
      
      if (err.code === 'auth/invalid-phone-number') errorMsg = 'מספר טלפון לא תקין.';
      if (err.code === 'auth/too-many-requests') errorMsg = 'יותר מדיי ניסיונות. נסה שוב מאוחר יותר.';
      if (err.code === 'auth/operation-not-allowed') {
        errorMsg = 'Check Firebase Console -> Auth -> Settings -> SMS Region Policy';
      }
      
      showToast(errorMsg, 'error');
      
      nuclearRecaptchaCleanup();
      setTwoFAState('idle');
    }
  };

  const handleVerifyCode = async () => {
    if (!otpCode.trim()) {
      showToast('יש להזין את קוד האימות', 'error');
      return;
    }
    setTwoFAState('verifying');
    try {
      await confirmationRef.current.confirm(otpCode.trim());
      setTwoFAState('verified');
      showToast('האימות הושלם בהצלחה! כעת תוכל לחתום על המסמך.', 'success');
    } catch (err) {
      console.error('2FA verify error:', err);
      showToast('קוד שגוי או שפג תוקפו. יש לנסות שוב.', 'error');
      setTwoFAState('waiting');
    }
  };

  // ---------------------------------------------------------------------------
  // Field-card helpers
  // ---------------------------------------------------------------------------

  // Derive which field types are required based on the loaded markers
  const hasSignature = markers.some((m) => !m.type || m.type === 'signature');

  // Build the list of text-field cards to render in the footer.
  // IMPORTANT: Each non-signature, non-date marker gets its OWN card (keyed
  // by position index) so AI-generated customText fields never share state,
  // even when they carry the same label or have no label at all.
  const textCards = [];
  let dateCardAdded = false;
  markers.forEach((m, idx) => {
    if (!m.type || m.type === 'signature') return;
    if (m.type === 'date') {
      if (!dateCardAdded) {
        dateCardAdded = true;
        textCards.push({ key: '__date__', label: getMarkerLabel(m), color: getMarkerColor(m) });
      }
      return;
    }
    // Every other field type (customText, text, …) → unique position-based key
    const key = getInputKey(m, idx);
    textCards.push({ key, label: getMarkerLabel(m), color: getMarkerColor(m) });
  });

  // All required fields are filled — drives button enabled state and status text
  const isFormReady =
    (!hasSignature || isSigned) &&
    textCards.every(({ key }) => (fieldValues[key] || '').trim() !== '');

  const handleFinish = async () => {
    if (!isFormReady) {
      showToast("Please sign and fill all fields before submitting.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const cleanupTargetUrl = originalPdfUrl.trim();

      // Build a per-marker-index formValues map that the API expects.
      // Uses getInputKey (same as the input cards) so values are always aligned.
      const formValues = {};
      markers.forEach((m, idx) => {
        const key = getInputKey(m, idx);
        if (key) formValues[idx] = fieldValues[key] || '';
      });

      let signatureData = null;
      if (hasSignature) {
        if (signMode === 'upload') {
          signatureData = uploadedSignature;
        } else {
          signatureData = sigCanvas.current.getCanvas().toDataURL('image/png');
        }
      }

      const response = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, signatureData, markers, formValues }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to sign the document.');

      const documentRef = doc(db, 'documents', documentId);
      await updateDoc(documentRef, {
        status: 'signed',
        signedAt: new Date().toISOString(),
        signedPdfUrl: result.downloadUrl,
      });

      let cleanupPromise = Promise.resolve();
      if (cleanupTargetUrl && cleanupTargetUrl !== result.downloadUrl) {
        setCleanupNotice('ניקוי אוטומטי של קובץ המקור פעיל.');
        cleanupPromise = storageCompat
          .refFromURL(cleanupTargetUrl)
          .delete()
          .catch((cleanupError) => {
            console.warn('Original PDF cleanup failed after a successful signing flow:', cleanupError);
          });
      } else {
        setCleanupNotice('');
        if (cleanupTargetUrl && cleanupTargetUrl === result.downloadUrl) {
          console.warn('Skipped original PDF cleanup because the original URL matches the signed URL.');
        }
      }

      setSignedPdfUrl(result.downloadUrl);
      setIsCompleted(true);
      showToast("Document signed successfully!", "success");
      await cleanupPromise;
    } catch (error) {
      console.error('Error during the signing process:', error);
      showToast(`An error occurred: ${error.message}`, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Centralized render router so we can ensure recaptcha-container is unconditionally present
  const renderContent = () => {
  // Missing file guard: link exists in DB but original file is removed
  if (missingFile) {
    return (
      <div className="success-screen">
        <div style={{ color: '#ef4444', marginBottom: '1rem' }}>
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        </div>
        <h1 style={{ color: '#ef4444' }}>File Missing</h1>
        <p>The document you are looking for has been removed from the server.</p>
        <p>Please contact the sender if you need a new copy.</p>
      </div>
    );
  }

  // Success screen view
  if (isCompleted) {
    return (
      <div className="success-screen">
        <h1>✓ Document Signed and Sent!</h1>
        <p>Thank you for completing the document.</p>
        {cleanupNotice && <p dir="rtl">{cleanupNotice}</p>}
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

  // Already-signed guard: this link has been used and is now locked
  if (isAlreadySigned) {
    return (
      <div className="success-screen">
        <h1>🔒 Link No Longer Active</h1>
        <p>This document has already been completed. Thank you!</p>
      </div>
    );
  }

  // 2FA gate: block access until the signer verifies their phone number
  if (is2FARequired && twoFAState !== 'verified') {
    return (
      <div className="signer-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 4px 32px rgba(0,0,0,0.12)',
          padding: '40px 32px',
          maxWidth: 400,
          width: '100%',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
          <h2 style={{ marginBottom: 8, fontSize: '1.4rem', color: '#1a1a1a' }}>אימות זהות</h2>
          <p style={{ color: '#555', marginBottom: 24, fontSize: '0.95rem' }}>
            לצורך אבטחה, יש לאמת את מספר הטלפון שלך לפני שניתן יהיה לחתום על המסמך.
          </p>

          {(twoFAState === 'idle' || twoFAState === 'sending') ? (
            <>
              <p style={{ color: '#333', marginBottom: 20, fontWeight: 500 }}>
                קוד SMS יישלח למספר: <span style={{ direction: 'ltr', display: 'inline-block' }}>{maskedPhone}</span>
              </p>
              <button
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px 0', fontSize: '1rem' }}
                onClick={handleSendCode}
                disabled={twoFAState === 'sending'}
              >
                {twoFAState === 'sending' ? 'שולח...' : 'שלח קוד אימות'}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: '#333', marginBottom: 12, fontWeight: 500 }}>
                הזן את הקוד שקיבלת ב-SMS:
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                style={{
                  width: '100%',
                  textAlign: 'center',
                  fontSize: '1.8rem',
                  letterSpacing: '0.4em',
                  padding: '10px 0',
                  border: '2px solid #d1d5db',
                  borderRadius: 8,
                  marginBottom: 16,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyCode(); }}
              />
              <button
                className="btn btn-success"
                style={{ width: '100%', padding: '12px 0', fontSize: '1rem', marginBottom: 10 }}
                onClick={handleVerifyCode}
                disabled={twoFAState === 'verifying'}
              >
                {twoFAState === 'verifying' ? 'מאמת...' : 'אמת וכנס'}
              </button>
              <button
                className="btn"
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.9rem' }}
                onClick={() => {
                  setOtpCode('');
                  nuclearRecaptchaCleanup();
                  setTwoFAState('idle');
                }}
              >
                לא קיבלת? שלח שוב
              </button>
            </>
          )}
        </div>
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
                    // Use globalIdx so the key matches the fieldValues slot assigned in textCards
                    const key = getInputKey(marker, marker.globalIdx);
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
                <div className="form-card form-card--sig" style={{ minWidth: '340px', maxWidth: 'none', display: 'flex', flexDirection: 'column', minHeight: '180px' }}>
                  <div className="form-card-header" style={{ color: '#e53e3e', borderBottomColor: '#e53e3e1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="form-card-label">Signature</span>
                      <div className="flex bg-gray-100 rounded-lg p-1 ml-2">
                        <button
                          className={`px-3 py-1 text-sm rounded-md transition-colors ${signMode === 'draw' ? 'bg-white shadow-sm font-bold text-red-600' : 'text-gray-500 hover:text-gray-700'}`}
                          onClick={() => { setSignMode('draw'); setIsSigned(false); sigCanvas.current?.clear(); }}
                        >
                          Draw
                        </button>
                        <button
                          className={`px-3 py-1 text-sm rounded-md transition-colors ${signMode === 'upload' ? 'bg-white shadow-sm font-bold text-red-600' : 'text-gray-500 hover:text-gray-700'}`}
                          onClick={() => { setSignMode('upload'); setIsSigned(!!uploadedSignature); }}
                        >
                          Upload
                        </button>
                      </div>
                    </div>
                    <button className="form-clear-btn z-10 relative bg-white rounded-full shadow-sm" style={{ padding: '4px 8px', marginLeft: 'auto' }} onClick={handleClearSignature} title="Clear signature">↺</button>
                  </div>
                  <div className="form-card-body" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    {signMode === 'draw' ? (
                      <div className="form-sig-wrap" style={{ flexGrow: 1, height: '120px', minHeight: '120px', borderColor: isSigned ? '#e53e3e55' : '#e0e0e0' }}>
                        <SignatureCanvas
                          ref={sigCanvas}
                          penColor="#1a1a1a"
                          onBegin={() => setIsSigned(true)}
                          canvasProps={{ className: 'sigCanvas', style: { width: '100%', height: '100%' } }}
                        />
                        {!isSigned && <div className="form-sig-placeholder">Sign here</div>}
                      </div>
                    ) : (
                      <div className="form-sig-wrap" style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: '10px', height: '120px', minHeight: '120px', borderColor: isSigned ? '#e53e3e55' : '#e0e0e0' }}>
                        {uploadedSignature ? (
                          <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            <img src={uploadedSignature} alt="Uploaded signature" className="object-contain max-h-full" style={{ maxHeight: '100%', maxWidth: '100%' }} />
                          </div>
                        ) : (
                          <label style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#666' }}>
                            <span style={{ fontSize: '24px', marginBottom: '8px' }}>📁</span>
                            <span style={{ fontSize: '14px', fontWeight: '500' }}>Click to upload image</span>
                            <span style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>PNG, JPG up to 2MB</span>
                            <input type="file" accept="image/png, image/jpeg, image/jpg" onChange={handleFileUpload} style={{ display: 'none' }} />
                          </label>
                        )}
                      </div>
                    )}
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

  return (
    <>
      {/* Invisible reCAPTCHA container MUST strictly remain in the DOM at all times */}
      <div id="recaptcha-container"></div>
      {renderContent()}
    </>
  );
};

export default SignerView;