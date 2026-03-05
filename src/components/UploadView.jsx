import React, { useState, useRef, useEffect } from 'react';
import { storage, db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getMarkerColor, getMarkerLabel, useWindowWidth } from '../utils/pdfHelpers';

// Set the worker source from a reliable CDN to ensure compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Predefined field types the admin can place on the document.
// 'customText' prompts the admin for a label after drawing the box.
const FIELD_TYPES = [
  { key: 'signature',  label: 'Signature',     type: 'signature',  color: '#e53e3e' },
  { key: 'date',       label: 'Date',           type: 'date',       color: '#059669' },
  { key: 'customText', label: '+ Custom Field', type: 'customText', color: '#2563eb' },
];



const UploadView = () => {
  // Expose auth helpers and the current user object from the auth context
  const { logout, currentUser } = useAuth();

  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileError, setFileError] = useState(''); // Validation error shown below the file input
  const [numPages, setNumPages] = useState(null);
  // markers is an array of { type, subtype, page, nx, ny, nw, nh } — one entry per drawn box
  const [markers, setMarkers] = useState([]);
  // The field type the admin has selected before drawing the next box
  const [activeFieldType, setActiveFieldType] = useState('signature');
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // ---------------------------------------------------------------------------
  // AI Suggestion state (Human-in-the-Loop)
  // suggestions: proposed markers returned by Gemini — not yet in markers[].
  // Each suggestion has a unique `id` so approve/reject can target it by key.
  // ---------------------------------------------------------------------------
  const [suggestions, setSuggestions] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState(null);
  // ID of the suggestion whose label is currently being edited inline
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Drag-to-draw state
  const windowWidth = useWindowWidth();

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [drawingBox, setDrawingBox] = useState(null);
  const currentPageRef = useRef(null);
  const pageRectRef = useRef(null);

  // When a customText box is drawn, hold it here until the admin names it
  const [pendingBox, setPendingBox] = useState(null);
  const [pendingLabel, setPendingLabel] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    // Reject files larger than 10 MB before doing anything else
    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) {
      setFileError('File is too large! Maximum allowed size is 10MB.');
      e.target.value = ''; // Clear the file input so the user can pick again
      return;
    }

    // Clear any previous error when a valid file is selected
    setFileError('');
    setFile(selectedFile);
    setGeneratedLink(''); // Reset link on new upload
    setIsCopied(false);   // Reset copied state on new upload
    setMarkers([]);
    setSuggestions([]);   // Discard any AI suggestions from a previous file
    setAiError(null);

    if (selectedFile) {
      setFileUrl(URL.createObjectURL(selectedFile));
    } else {
      setFileUrl(null);
    }
  };

  const handleDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  // Record start point and page rect when the user begins dragging
  const handleMouseDown = (e, pageNumber) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    pageRectRef.current = rect;
    currentPageRef.current = pageNumber;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    setIsDrawing(true);
    setDrawStart({ nx, ny });
    setDrawingBox(null);
  };

  // Update the live preview box while the user drags
  const handleMouseMove = (e, pageNumber) => {
    if (!isDrawing || pageNumber !== currentPageRef.current || !pageRectRef.current) return;
    const rect = pageRectRef.current;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    // Support dragging in any direction by normalizing start/end
    setDrawingBox({
      nx: Math.min(drawStart.nx, nx),
      ny: Math.min(drawStart.ny, ny),
      nw: Math.abs(nx - drawStart.nx),
      nh: Math.abs(ny - drawStart.ny),
    });
  };

  // Finalize the bounding box when the user releases the mouse
  const handleMouseUp = (e, pageNumber) => {
    if (!isDrawing) return;
    const rect = pageRectRef.current;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const boxNx = Math.min(drawStart.nx, nx);
    const boxNy = Math.min(drawStart.ny, ny);
    const boxNw = Math.abs(nx - drawStart.nx);
    const boxNh = Math.abs(ny - drawStart.ny);
    setIsDrawing(false);
    setDrawingBox(null);
    // Only add the marker if the box is large enough to be intentional (> 1% in both dimensions)
    if (boxNw > 0.01 && boxNh > 0.01) {
      const ft = FIELD_TYPES.find((f) => f.key === activeFieldType) || FIELD_TYPES[0];
      if (ft.type === 'customText') {
        // Custom fields need a label — open the naming dialog before committing
        setPendingBox({ type: ft.type, page: pageNumber, nx: boxNx, ny: boxNy, nw: boxNw, nh: boxNh });
        setPendingLabel('');
      } else {
        setMarkers((prev) => [
          ...prev,
          { type: ft.type, page: pageNumber, nx: boxNx, ny: boxNy, nw: boxNw, nh: boxNh },
        ]);
      }
    }
  };

  // Remove a specific marker by its index in the global markers array
  const handleRemoveMarker = (indexToRemove) => {
    setMarkers((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  // ---------------------------------------------------------------------------
  // handleAnalyze
  // Encodes the selected PDF as base64 and sends it to /api/analyze-pdf.
  // The response populates the `suggestions` array — nothing is saved to
  // Firestore yet.  The admin must approve each suggestion individually.
  // ---------------------------------------------------------------------------
  const handleAnalyze = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setAiError(null);
    setSuggestions([]);

    try {
      // Use FileReader instead of btoa() + Uint8Array.
      // btoa() throws "Invalid character" on binary PDFs larger than ~1 MB because
      // it cannot handle raw byte values above 0x7F.
      // FileReader.readAsDataURL() handles arbitrary binary data correctly and
      // returns a safe data-URI; we strip the prefix so only raw base64 is sent.
      const base64Pdf = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => {
          // result format: "data:application/pdf;base64,JVBERi0x..."
          // Split at the comma and take everything after it (raw base64 only).
          resolve(reader.result.split(',')[1]);
        };
        reader.onerror = () => reject(new Error('FileReader failed to read the PDF.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/analyze-pdf', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ base64Pdf }),
      });

      if (!response.ok) {
        // Detect quota-exceeded (429) before reading the body so we can show
        // a friendly message regardless of what the backend error text says.
        if (response.status === 429) {
          throw new Error('AI Quota Reached: The free tier limit has been exceeded. Please wait about 60 seconds and try again or use a smaller document.');
        }
        const err = await response.json();
        throw new Error(err.error || 'AI analysis failed.');
      }

      const { suggestions: raw } = await response.json();

      // Attach a unique ID to each suggestion so we can target it on approve/reject
      setSuggestions(raw.map((s) => ({ ...s, id: crypto.randomUUID() })));
    } catch (error) {
      console.error('[AI] Analysis error:', error);
      // Also catch quota errors that surfaced through the error message text
      const msg = error.message || '';
      if (msg.includes('429') || /quota/i.test(msg)) {
        setAiError({
          title: 'Daily Limit Reached',
          description: 'The AI has reached its free-tier limit. Please wait about 60 seconds and try again, or add the fields manually.',
        });
      } else {
        setAiError({
          title: 'Oops! The AI needs a moment',
          description: 'We hit a small snag while trying to read your document, but you can give it another try or simply add the fields yourself.',
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // approveSuggestion
  // Promotes a ghost suggestion into the confirmed markers array and removes
  // it from suggestions.  If label editing was open for this suggestion, the
  // current editingLabel value is used instead of the original label.
  // ---------------------------------------------------------------------------
  const approveSuggestion = (id) => {
    setSuggestions((prev) => {
      const suggestion = prev.find((s) => s.id === id);
      if (!suggestion) return prev;

      const confirmedLabel =
        editingSuggestionId === id ? editingLabel.trim() || suggestion.label : suggestion.label;

      const newMarker = {
        type:  suggestion.type,
        page:  suggestion.page,
        nx:    suggestion.nx,
        ny:    suggestion.ny,
        nw:    suggestion.nw,
        nh:    suggestion.nh,
        // Only attach label for non-signature, non-date types
        ...(suggestion.type === 'customText' ? { label: confirmedLabel } : {}),
      };

      setMarkers((m) => [...m, newMarker]);
      // Clear edit state if this suggestion was being edited
      if (editingSuggestionId === id) setEditingSuggestionId(null);
      return prev.filter((s) => s.id !== id);
    });
  };

  // ---------------------------------------------------------------------------
  // rejectSuggestion
  // Removes a ghost suggestion without adding it to markers.
  // ---------------------------------------------------------------------------
  const rejectSuggestion = (id) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    if (editingSuggestionId === id) setEditingSuggestionId(null);
  };

  // Approve all suggestions at once — convenience button
  const approveAll = () => {
    setSuggestions((prev) => {
      const newMarkers = prev.map((s) => ({
        type:  s.type,
        page:  s.page,
        nx:    s.nx,
        ny:    s.ny,
        nw:    s.nw,
        nh:    s.nh,
        ...(s.type === 'customText' ? { label: s.label } : {}),
      }));
      setMarkers((m) => [...m, ...newMarkers]);
      return [];
    });
    setEditingSuggestionId(null);
  };

  // Confirm the pending customText box by attaching the admin's label and adding it to markers
  const confirmPendingBox = () => {
    if (!pendingBox || !pendingLabel.trim()) return;
    setMarkers((prev) => [...prev, { ...pendingBox, label: pendingLabel.trim() }]);
    setPendingBox(null);
    setPendingLabel('');
  };

  // ---------------------------------------------------------------------------
  // saveDocumentToFirestore
  // Writes the confirmed document record to the `documents` Firestore collection.
  //
  // Schema written:
  //   fileName  {string}  Original filename as selected by the admin
  //   fileUrl   {string}  Firebase Storage download URL (not the storage path)
  //   ownerId   {string}  Firebase Auth UID of the admin who uploaded the file
  //   createdAt {string}  ISO-8601 timestamp of when the record was created
  //   fields    {Array}   Flat array of confirmed field markers (Human-in-the-Loop
  //                       approved). Each entry mirrors the marker schema:
  //                       { index, type, page, nx, ny, nw, nh, label? }
  //
  // Design rationale: fields are stored as a flat array instead of a sub-collection
  // because all fields are always read together (never paginated individually),
  // so a single document read is more efficient than N sub-collection reads.
  // ---------------------------------------------------------------------------
  const saveDocumentToFirestore = async (fileId, fileName, fileUrl, confirmedMarkers) => {
    const documentRef = doc(db, 'documents', fileId);

    await setDoc(documentRef, {
      fileName,
      fileUrl,
      ownerId:   currentUser.uid,
      createdAt: new Date().toISOString(),
      // Map markers to a clean schema; `label` is only included for customText fields
      fields: confirmedMarkers.map((marker, index) => ({
        index,
        type:  marker.type  || 'signature',
        page:  marker.page  ?? 1,
        nx:    marker.nx,
        ny:    marker.ny,
        nw:    marker.nw,
        nh:    marker.nh,
        ...(marker.label ? { label: marker.label } : {}),
      })),
    });
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a PDF file first.');
      return;
    }
    if (markers.length === 0 && suggestions.length > 0) {
      alert(`You have ${suggestions.length} pending AI suggestions. Please approve or reject them before uploading.`);
      return;
    }
    if (markers.length === 0) {
      alert('Please drag on the document to place at least one field.');
      return;
    }
    
    setUploading(true);

    try {
      setGeneratedLink('');
      setIsCopied(false);

      const fileId = uuidv4();

      // Step 1 — upload the PDF binary to Firebase Storage
      const storageRef = ref(storage, `pdfs/${fileId}.pdf`);
      await uploadBytes(storageRef, file);

      // Step 2 — retrieve the permanent download URL from Firebase Storage
      const fileUrl = await getDownloadURL(storageRef);

      // Step 3 — save the full document record (including confirmed fields) to Firestore
      await saveDocumentToFirestore(fileId, file.name, fileUrl, markers);

      // Step 4 — generate and display the shareable signing link
      const link = `${window.location.origin}/sign/${fileId}`;
      setGeneratedLink(link);
    } catch (error) {
      // Log EXACT Firebase error clearly into the console
      console.error("=== FIREBASE UPLOAD ERROR ===");
      console.error(error);
      console.error("Error Code:", error?.code);
      console.error("Error Message:", error?.message);
      alert(`Upload failed: ${error?.message || "Unknown error occurred. Check browser console."}`);
    } finally {
      // Explicitly clean up loading state unconditionally so the UI never hangs
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

  const shareOnWhatsApp = () => {
    const message = `You've been sent a document to sign: ${generatedLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="upload-view">
      {/* Sign Out button — fixed to the top-right corner of the upload card */}
      <button
        onClick={logout}
        className="btn btn-secondary signout-btn"
      >
        Sign Out
      </button>

      <h1>SignFlow</h1>
      <p className="subtitle">Upload a PDF document to generate a shareable signing link.</p>
      
      <div className="drop-zone">
        <input 
          type="file" 
          accept="application/pdf" 
          onChange={handleFileChange} 
          className="file-input"
        />
      </div>

      {/* Inline error shown when the selected file exceeds the size limit */}
      {fileError && (
        <p style={{
          color: '#dc2626',
          backgroundColor: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          padding: '8px 12px',
          marginTop: '10px',
          fontSize: '0.9rem',
          fontWeight: 500,
        }}>
          {fileError}
        </p>
      )}

      {/* Render PDF Preview to select signature location */}
      {fileUrl && !generatedLink && (
        <div style={{ marginTop: '20px' }}>
          <p style={{ fontWeight: 600, color: 'var(--primary-color)', marginBottom: '5px' }}>
            Action Required: Select a field type, then click and drag to place it on the document.
          </p>
          <p style={{ color: 'var(--text-light-color)', fontSize: '0.9rem', marginBottom: '10px' }}>
            You can place multiple fields of different types. Click &times; on any field to remove it.
          </p>

          {/* Field type selector + AI detect button */}
          <div className="field-type-selector" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            {FIELD_TYPES.map((ft) => (
              <button
                key={ft.key}
                className={`field-type-btn${activeFieldType === ft.key ? ' active' : ''}`}
                onClick={() => setActiveFieldType(ft.key)}
                style={{
                  borderColor: ft.color,
                  color: activeFieldType === ft.key ? 'white' : ft.color,
                  backgroundColor: activeFieldType === ft.key ? ft.color : 'transparent',
                }}
              >
                {ft.label}
              </button>
            ))}

            {/* Vertical divider */}
            <span style={{ borderLeft: '1px solid #d1d5db', height: 28, margin: '0 4px' }} />

            {/* AI detection trigger button */}
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1.5px solid #7c3aed',
                backgroundColor: isAnalyzing ? '#ede9fe' : '#7c3aed',
                color: isAnalyzing ? '#7c3aed' : 'white',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s',
              }}
            >
              {isAnalyzing ? (
                <>
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                  Analyzing…
                </>
              ) : (
                <>🤖 Detect Fields with AI</>
              )}
            </button>
          </div>

          {/* AI error message — shown as a dismissible red banner with Retry/Close actions */}
          {aiError && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              color: '#b91c1c',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: '0.85rem',
              marginTop: 8,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠️ {aiError.title}</div>
                <div style={{ color: '#991b1b', fontWeight: 400 }}>{aiError.description}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 1 }}>
                {/* Retry: dismiss the error and immediately re-run the analysis */}
                <button
                  onClick={() => { setAiError(null); handleAnalyze(); }}
                  style={{
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                  }}
                >
                  Retry
                </button>
                {/* Close: dismiss the error without retrying */}
                <button
                  onClick={() => setAiError(null)}
                  style={{
                    background: 'transparent',
                    color: '#b91c1c',
                    border: '1px solid #fca5a5',
                    borderRadius: 4,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Pending AI suggestions banner */}
          {suggestions.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#f5f3ff',
              border: '1px solid #c4b5fd',
              borderRadius: 8,
              padding: '8px 14px',
              marginTop: 10,
              fontSize: '0.88rem',
              color: '#4c1d95',
            }}>
              <span>🤖 <strong>{suggestions.length}</strong> AI suggestion{suggestions.length !== 1 ? 's' : ''} pending review — approve or reject each field below.</span>
              <button
                onClick={approveAll}
                style={{
                  marginLeft: 'auto',
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: '1.5px solid #7c3aed',
                  background: '#7c3aed',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                ✓ Approve All
              </button>
              <button
                onClick={() => setSuggestions([])}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: '1.5px solid #dc2626',
                  background: 'transparent',
                  color: '#dc2626',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                ✕ Reject All
              </button>
            </div>
          )}

          {activeFieldType === 'customText' && (
            <p style={{ fontSize: '0.82rem', color: '#2563eb', marginBottom: 8, marginTop: 4 }}>
              Drag a box on the PDF, then name the field.
            </p>
          )}

          {/* Label dialog — shown after the admin draws a customText box */}
          {pendingBox && (
            <div className="label-dialog-overlay">
              <div className="label-dialog">
                <h3 className="label-dialog-title">Name this field</h3>
                <p className="label-dialog-desc">Enter a label so the signer knows what to write (e.g. "Full Name", "ID Number", "Company").</p>
                <input
                  autoFocus
                  className="label-dialog-input"
                  type="text"
                  placeholder="Field label"
                  value={pendingLabel}
                  onChange={(e) => setPendingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pendingLabel.trim()) confirmPendingBox();
                    if (e.key === 'Escape') setPendingBox(null);
                  }}
                />
                <div className="label-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setPendingBox(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={confirmPendingBox} disabled={!pendingLabel.trim()}>Add Field</button>
                </div>
              </div>
            </div>
          )}

          <div className="pdf-document-container" style={{ textAlign: 'center' }}>
            <Document 
              file={fileUrl} 
              onLoadSuccess={handleDocumentLoadSuccess}
              loading={<div>Loading PDF preview...</div>}
            >
              {Array.from(new Array(numPages), (el, index) => {
                const pageNumber = index + 1;
                // All confirmed markers that belong to this page, with their global index
                const pageMarkers = markers
                  .map((m, i) => ({ ...m, globalIndex: i }))
                  .filter((m) => m.page === pageNumber);

                return (
                  <div
                    key={`page_${pageNumber}`}
                    className="pdf-page-wrapper"
                    style={{ cursor: 'crosshair', userSelect: 'none' }}
                    onMouseDown={(e) => handleMouseDown(e, pageNumber)}
                    onMouseMove={(e) => handleMouseMove(e, pageNumber)}
                    onMouseUp={(e) => handleMouseUp(e, pageNumber)}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={Math.min(windowWidth - 80, 550)}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                    {/* Live preview rectangle while the user is dragging on this page */}
                    {isDrawing && currentPageRef.current === pageNumber && drawingBox && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${drawingBox.nx * 100}%`,
                          top: `${drawingBox.ny * 100}%`,
                          width: `${drawingBox.nw * 100}%`,
                          height: `${drawingBox.nh * 100}%`,
                          border: '2px dashed #2563eb',
                          backgroundColor: 'rgba(37, 99, 235, 0.1)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    {/* Render all confirmed markers for this page with type-specific color and label */}
                    {pageMarkers.map((marker) => {
                      const color = getMarkerColor(marker);
                      return (
                        <div
                          key={marker.globalIndex}
                          className="signature-marker"
                          style={{
                            left: `${marker.nx * 100}%`,
                            top: `${marker.ny * 100}%`,
                            width: `${marker.nw * 100}%`,
                            height: `${marker.nh * 100}%`,
                            borderColor: color,
                            backgroundColor: `${color}28`,
                            color,
                          }}
                        >
                          <span>{getMarkerLabel(marker)}</span>
                          {/* Remove button stops propagation so it does not start a new drag */}
                          <button
                            className="marker-remove-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveMarker(marker.globalIndex);
                            }}
                            title="Remove this field"
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}

                    {/* Ghost markers — AI suggestions pending admin review */}
                    {suggestions
                      .filter((s) => s.page === pageNumber)
                      .map((suggestion) => {
                        // Confidence shades the ghost: ≥80% = green-tinted, else amber
                        const isHighConf  = suggestion.confidence >= 0.8;
                        const ghostBorder = isHighConf ? '#7c3aed' : '#d97706';
                        const ghostBg     = isHighConf ? 'rgba(124,58,237,0.10)' : 'rgba(217,119,6,0.10)';
                        const isEditing   = editingSuggestionId === suggestion.id;

                        return (
                          <div
                            key={suggestion.id}
                            onMouseDown={(e) => e.stopPropagation()} // Prevent drawing a new box when clicking ghost controls
                            style={{
                              position:        'absolute',
                              left:            `${suggestion.nx * 100}%`,
                              top:             `${suggestion.ny * 100}%`,
                              width:           `${suggestion.nw * 100}%`,
                              height:          `${suggestion.nh * 100}%`,
                              border:          `2px dashed ${ghostBorder}`,
                              backgroundColor: ghostBg,
                              borderRadius:    4,
                              boxSizing:       'border-box',
                              pointerEvents:   'all',
                              zIndex:          10,
                            }}
                          >
                            {/* Label row inside the ghost box */}
                            <span style={{
                              position:   'absolute',
                              bottom:     '100%',
                              left:       0,
                              fontSize:   '0.65rem',
                              fontWeight: 700,
                              color:      ghostBorder,
                              whiteSpace: 'nowrap',
                              lineHeight: 1.2,
                              padding:    '1px 3px',
                              background: 'white',
                              borderRadius: 2,
                              transform:  'translateY(-1px)',
                            }}>
                              🤖 {suggestion.label}
                              {' '}({Math.round(suggestion.confidence * 100)}%)
                            </span>

                            {/* Inline label editor — shown when the pencil icon is clicked */}
                            {isEditing && (
                              <div
                                style={{
                                  position:   'absolute',
                                  top:        '100%',
                                  left:       0,
                                  zIndex:     20,
                                  background: 'white',
                                  border:     '1px solid #c4b5fd',
                                  borderRadius: 6,
                                  padding:    '6px 8px',
                                  boxShadow:  '0 4px 12px rgba(0,0,0,0.15)',
                                  minWidth:   140,
                                  display:    'flex',
                                  gap:        4,
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <input
                                  autoFocus
                                  value={editingLabel}
                                  onChange={(e) => setEditingLabel(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') approveSuggestion(suggestion.id);
                                    if (e.key === 'Escape') setEditingSuggestionId(null);
                                  }}
                                  style={{
                                    flex:       1,
                                    border:     '1px solid #d1d5db',
                                    borderRadius: 4,
                                    padding:    '3px 6px',
                                    fontSize:   '0.8rem',
                                    outline:    'none',
                                    minWidth:   0,
                                  }}
                                  placeholder="Field label…"
                                />
                                <button
                                  onClick={() => approveSuggestion(suggestion.id)}
                                  style={{
                                    background: '#7c3aed', color: 'white',
                                    border: 'none', borderRadius: 4,
                                    padding: '3px 7px', cursor: 'pointer', fontWeight: 700,
                                  }}
                                  title="Approve with this label"
                                >
                                  ✓
                                </button>
                              </div>
                            )}

                            {/* Floating action bar — approve / edit / reject */}
                            <div style={{
                              position:       'absolute',
                              top:            2,
                              right:          2,
                              display:        'flex',
                              gap:            3,
                              pointerEvents:  'all',
                            }}>
                              {/* Approve button */}
                              <button
                                title="Approve this field"
                                onClick={(e) => { e.stopPropagation(); approveSuggestion(suggestion.id); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  width: 22, height: 22, borderRadius: 4,
                                  border: 'none', background: '#059669',
                                  color: 'white', fontSize: '0.75rem',
                                  cursor: 'pointer', fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >✓</button>

                              {/* Edit label button — only shown for customText */}
                              {suggestion.type === 'customText' && (
                                <button
                                  title="Edit label before approving"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSuggestionId(isEditing ? null : suggestion.id);
                                    setEditingLabel(suggestion.label);
                                  }}
                                  style={{
                                    width: 22, height: 22, borderRadius: 4,
                                    border: 'none', background: '#2563eb',
                                    color: 'white', fontSize: '0.7rem',
                                    cursor: 'pointer', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}
                                >✎</button>
                              )}

                              {/* Reject button */}
                              <button
                                title="Reject this suggestion"
                                onClick={(e) => { e.stopPropagation(); rejectSuggestion(suggestion.id); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  width: 22, height: 22, borderRadius: 4,
                                  border: 'none', background: '#dc2626',
                                  color: 'white', fontSize: '0.8rem',
                                  cursor: 'pointer', fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >✕</button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </Document>
          </div>
          
        </div>
      )}

      {/* Sticky footer — visible while the admin is placing fields but before the link is generated */}
      {fileUrl && !generatedLink && (
        <div className="action-footer">
          <div className="action-footer-inner">
            <p className="action-footer-status">
              Confirmed Fields:{' '}
              <span className="action-footer-count">{markers.length}</span>
              {suggestions.length > 0 && (
                <span style={{
                  marginLeft: 10,
                  padding: '1px 8px',
                  borderRadius: 10,
                  background: '#ede9fe',
                  color: '#6d28d9',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}>
                  {suggestions.length} AI pending
                </span>
              )}
            </p>
            <button
              onClick={handleUpload}
              disabled={uploading || markers.length === 0}
              className="btn btn-primary"
            >
              {uploading ? 'Uploading...' : 'Upload & Generate Link'}
            </button>
          </div>
        </div>
      )}

      {generatedLink && (
        <div className="generated-link-container">
          <p>Your link is ready:</p>
          <div className="link-input-group">
            <input 
              type="text" 
              value={generatedLink} 
              readOnly 
            />
            <button 
              onClick={copyToClipboard} 
              className="btn btn-success"
            >
              {isCopied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={shareOnWhatsApp}
              className="btn btn-primary"
              style={{ backgroundColor: '#25D366' }} // WhatsApp green color
            >
              WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadView;