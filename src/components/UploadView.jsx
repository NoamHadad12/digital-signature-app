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
import { logAction } from '../utils/logger';
import { updateDocumentStatus } from '../services/dbService';

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
  // ID of the document just uploaded — used to update status to 'sent' on link copy
  const [uploadedDocId, setUploadedDocId] = useState('');
  const [numPages, setNumPages] = useState(null);
  // Single source of truth for ALL fields on the document.
  // Each entry: { id, type, label?, page, nx, ny, nw, nh, confirmed: boolean }
  // confirmed=true  → solid border, saved on Upload
  // confirmed=false → dashed border, AI suggestion awaiting approval
  const [fields, setFields] = useState([]);
  // The field type the admin has selected before drawing the next box
  const [activeFieldType, setActiveFieldType] = useState('signature');
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState(null);
  // ID of the field whose label is currently being edited inline
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Drag-to-draw state
  const windowWidth = useWindowWidth();

  const [isDrawing, setIsDrawing] = useState(false);
  // Tracks the single active pointer interaction: array index + action type
  // type: 'move' | 'resize' | null
  const [interaction, setInteraction] = useState({ index: null, type: null });
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
    setUploadedDocId(''); // Reset tracked doc ID on new upload
    setFields([]);        // Discard all fields (confirmed and pending) from a previous file
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
        // Manually drawn fields are immediately confirmed
        setFields((prev) => [
          ...prev,
          { id: crypto.randomUUID(), type: ft.type, page: pageNumber, nx: boxNx, ny: boxNy, nw: boxNw, nh: boxNh, confirmed: true },
        ]);
      }
    }
  };

  // Remove a field by its unique ID, regardless of whether it is confirmed or pending
  const handleRemoveField = (idToRemove) => {
    setFields((prev) => prev.filter((f) => f.id !== idToRemove));
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
    // Remove any existing unconfirmed AI suggestions before a fresh analysis run
    setFields((prev) => prev.filter((f) => f.confirmed));

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
      console.log("Suggestions received:", raw);

      // Append each AI suggestion as an unconfirmed field with a unique ID
      setFields((prev) => [
        ...prev,
        ...raw.map((s) => ({ ...s, id: crypto.randomUUID(), confirmed: false })),
      ]);
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
  // Marks an unconfirmed field as confirmed (dashed → solid border).
  // If an inline label edit was open for this field, the current value is applied.
  // ---------------------------------------------------------------------------
  const approveSuggestion = (id) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const confirmedLabel =
          editingSuggestionId === id ? editingLabel.trim() || f.label : f.label;
        return {
          ...f,
          confirmed: true,
          ...(f.type === 'customText' ? { label: confirmedLabel } : {}),
        };
      })
    );
    if (editingSuggestionId === id) setEditingSuggestionId(null);
  };

  // ---------------------------------------------------------------------------
  // rejectSuggestion
  // Removes an unconfirmed field without promoting it.
  // ---------------------------------------------------------------------------
  const rejectSuggestion = (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (editingSuggestionId === id) setEditingSuggestionId(null);
  };

  // Confirm all pending AI suggestions at once
  const approveAll = () => {
    setFields((prev) => prev.map((f) => ({ ...f, confirmed: true })));
    setEditingSuggestionId(null);
  };

  // Confirm the pending customText box by attaching the admin's label and adding it to fields
  const confirmPendingBox = () => {
    if (!pendingBox || !pendingLabel.trim()) return;
    setFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), ...pendingBox, label: pendingLabel.trim(), confirmed: true },
    ]);
    setPendingBox(null);
    setPendingLabel('');
  };

  // ---------------------------------------------------------------------------
  // saveDocumentToFirestore
  // Writes the confirmed document record to the `documents` Firestore collection.
  // clientId is always set to currentUser.uid — the user cannot override it.
  // status is initialized to 'draft' and advances as the document lifecycle progresses.
  // ---------------------------------------------------------------------------
  const saveDocumentToFirestore = async (fileId, fileName, fileUrl, confirmedFields) => {
    const documentRef = doc(db, 'documents', fileId);

    await setDoc(documentRef, {
      fileName,
      fileUrl,
      // clientId is automatically bound to the authenticated user's UID — privacy by design
      clientId:  currentUser.uid,
      ownerId:   currentUser.uid,
      // Initial lifecycle status; advances to 'sent' → 'opened' → 'signed'
      status:    'draft',
      createdAt: new Date().toISOString(),
      // Map fields to a clean schema; `label` is only included for customText fields
      fields: confirmedFields.map((field, index) => ({
        index,
        type:  field.type  || 'signature',
        page:  field.page  ?? 1,
        nx:    field.nx,
        ny:    field.ny,
        nw:    field.nw,
        nh:    field.nh,
        ...(field.label ? { label: field.label } : {}),
      })),
    });

    await logAction('create_doc', fileId, { fileName, clientId: currentUser.uid, ownerId: currentUser.uid });
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a PDF file first.');
      return;
    }
    const confirmedFields  = fields.filter((f) => f.confirmed);
    const pendingFields    = fields.filter((f) => !f.confirmed);
    if (confirmedFields.length === 0 && pendingFields.length > 0) {
      alert(`You have ${pendingFields.length} pending AI suggestions. Please approve or reject them before uploading.`);
      return;
    }
    if (confirmedFields.length === 0) {
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
      await saveDocumentToFirestore(fileId, file.name, fileUrl, confirmedFields);

      // Step 4 — generate and display the shareable signing link
      const link = `${window.location.origin}/sign/${fileId}`;
      setGeneratedLink(link);
      // Store the doc ID so copyToClipboard can update the status to 'sent'
      setUploadedDocId(fileId);
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
      setTimeout(() => setIsCopied(false), 2000);
      // Advance status to 'sent' the first time the owner copies the link
      if (uploadedDocId) {
        updateDocumentStatus(uploadedDocId, 'sent').catch((err) =>
          console.warn('[status] Failed to mark document as sent:', err)
        );
      }
    }, (err) => {
      console.error('Failed to copy link: ', err);
    });
  };

  const shareOnWhatsApp = () => {
    const message = `You've been sent a document to sign: ${generatedLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    // Also advance status to 'sent' when sharing via WhatsApp
    if (uploadedDocId) {
      updateDocumentStatus(uploadedDocId, 'sent').catch((err) =>
        console.warn('[status] Failed to mark document as sent:', err)
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Sticky top navigation header ─────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-gray-900 tracking-tight">SignFlow</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.location.href = '/admin'}
            className="text-sm font-medium text-gray-600 hover:text-blue-600 border border-gray-300
                       hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Admin Dashboard
          </button>
          <button
            onClick={logout}
            className="text-sm font-medium text-gray-500 hover:text-red-600 border border-gray-300
                       hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* ── Centred content card ──────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="upload-view">
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
          {fields.some((f) => !f.confirmed) && (
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
              <span>🤖 <strong>{fields.filter((f) => !f.confirmed).length}</strong> AI suggestion{fields.filter((f) => !f.confirmed).length !== 1 ? 's' : ''} pending review — approve or reject each field below.</span>
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
                onClick={() => setFields((prev) => prev.filter((f) => f.confirmed))}
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
                // All fields that belong to this page, with their position in the global array
                const pageFields = fields
                  .map((f, i) => ({ ...f, globalIndex: i }))
                  .filter((f) => f.page === pageNumber);

                return (
                  <div
                    key={`page_${pageNumber}`}
                    className="pdf-page-wrapper"
                    style={{
                      cursor: interaction.index !== null ? (interaction.type === 'resize' ? 'nwse-resize' : 'grabbing') : 'crosshair',
                      userSelect: 'none',
                    }}
                    onMouseDown={(e) => handleMouseDown(e, pageNumber)}
                    onMouseMove={(e) => handleMouseMove(e, pageNumber)}
                    onMouseUp={(e) => handleMouseUp(e, pageNumber)}
                    onPointerMove={(e) => {
                      if (interaction.index === null) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const curNx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      const curNy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                      setFields((prev) =>
                        prev.map((f, i) => {
                          if (i !== interaction.index) return f;
                          if (interaction.type === 'move') return { ...f, nx: curNx, ny: curNy };
                          // Resize: distance from field's fixed top-left corner to the cursor
                          const newNw = Math.max(0.05, Math.min(1 - f.nx, curNx - f.nx));
                          const newNh = Math.max(0.02, Math.min(1 - f.ny, curNy - f.ny));
                          return { ...f, nw: newNw, nh: newNh };
                        })
                      );
                    }}
                    onPointerUp={() => setInteraction({ index: null, type: null })}
                    onPointerLeave={() => setInteraction({ index: null, type: null })}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={Math.min(windowWidth - 80, 550)}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                    {/* Live preview rectangle while the user is drawing a new box on this page */}
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

                    {/* Unified field renderer: confirmed fields have a solid border, pending AI fields have dashed */}
                    {pageFields.map((field) => {
                      const color       = getMarkerColor(field);
                      const isActive    = interaction.index === field.globalIndex;
                      const isEditing   = editingSuggestionId === field.id;
                      const borderStyle = field.confirmed ? `2px solid ${color}` : `2px dashed ${color}`;

                      return (
                        <div
                          key={field.id}
                          onMouseDown={(e) => e.stopPropagation()} // Prevent triggering a new draw box
                          onPointerDown={(e) => {
                            // Field body pointer-down starts a move interaction
                            e.stopPropagation();
                            e.preventDefault();
                            setInteraction({ index: field.globalIndex, type: 'move' });
                          }}
                          style={{
                            position:        'absolute',
                            left:            `${field.nx * 100}%`,
                            top:             `${field.ny * 100}%`,
                            width:           `${field.nw * 100}%`,
                            height:          `${field.nh * 100}%`,
                            border:          borderStyle,
                            backgroundColor: `${color}22`,
                            borderRadius:    4,
                            boxSizing:       'border-box',
                            pointerEvents:   'all',
                            zIndex:          10,
                            cursor:          isActive && interaction.type === 'move' ? 'grabbing' : 'grab',
                            color,
                          }}
                        >
                          {/* Field label shown inside the box */}
                          <span style={{
                            position:   'absolute',
                            bottom:     '100%',
                            left:       0,
                            fontSize:   '0.65rem',
                            fontWeight: 700,
                            color,
                            whiteSpace: 'nowrap',
                            lineHeight: 1.2,
                            padding:    '1px 3px',
                            background: 'white',
                            borderRadius: 2,
                            transform:  'translateY(-1px)',
                          }}>
                            {!field.confirmed && '🤖 '}{field.label || field.type}
                          </span>

                          {/* Inline label editor — shown when the pencil icon is clicked for customText fields */}
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
                                  if (e.key === 'Enter') approveSuggestion(field.id);
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
                                onClick={() => approveSuggestion(field.id)}
                                style={{
                                  background: '#7c3aed', color: 'white',
                                  border: 'none', borderRadius: 4,
                                  padding: '3px 7px', cursor: 'pointer', fontWeight: 700,
                                }}
                                title="Save label"
                              >
                                ✓
                              </button>
                            </div>
                          )}

                          {/* Floating action bar — always visible for all fields */}
                          <div style={{
                            position:      'absolute',
                            top:           2,
                            right:         2,
                            display:       'flex',
                            gap:           3,
                            pointerEvents: 'all',
                          }}>
                            {/* Approve button — only shown for unconfirmed AI suggestions */}
                            {!field.confirmed && (
                              <button
                                title="Approve this field"
                                onClick={(e) => { e.stopPropagation(); approveSuggestion(field.id); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                style={{
                                  width: 22, height: 22, borderRadius: 4,
                                  border: 'none', background: '#059669',
                                  color: 'white', fontSize: '0.75rem',
                                  cursor: 'pointer', fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >✓</button>
                            )}

                            {/* Edit label button — only for unconfirmed customText fields */}
                            {!field.confirmed && field.type === 'customText' && (
                              <button
                                title="Edit label before approving"
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSuggestionId(isEditing ? null : field.id);
                                  setEditingLabel(field.label);
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

                            {/* Delete button — always visible for every field */}
                            <button
                              title="Remove this field"
                              onClick={(e) => { e.stopPropagation(); handleRemoveField(field.id); }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              style={{
                                width: 22, height: 22, borderRadius: 4,
                                border: 'none', background: '#dc2626',
                                color: 'white', fontSize: '0.8rem',
                                cursor: 'pointer', fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                            >×</button>
                          </div>

                          {/* Resize handle — drag the bottom-right corner to change width and height */}
                          <div
                            title="Resize this field"
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setInteraction({ index: field.globalIndex, type: 'resize' });
                            }}
                            style={{
                              position:        'absolute',
                              bottom:          0,
                              right:           0,
                              width:           10,
                              height:          10,
                              backgroundColor: color,
                              cursor:          'nwse-resize',
                              borderRadius:    '2px 0 0 0',
                            }}
                          />
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
              <span className="action-footer-count">{fields.filter((f) => f.confirmed).length}</span>
              {fields.some((f) => !f.confirmed) && (
                <span style={{
                  marginLeft: 10,
                  padding: '1px 8px',
                  borderRadius: 10,
                  background: '#ede9fe',
                  color: '#6d28d9',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                }}>
                  {fields.filter((f) => !f.confirmed).length} AI pending
                </span>
              )}
            </p>
            <button
              onClick={handleUpload}
              disabled={uploading || fields.filter((f) => f.confirmed).length === 0}
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
      </div>{/* closes .upload-view */}
      </div>{/* closes max-w-3xl wrapper */}
    </div>{/* closes min-h-screen */}
  );
};

export default UploadView;