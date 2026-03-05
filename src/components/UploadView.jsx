import React, { useState, useRef, useEffect } from 'react';
import { storage } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ref, uploadBytes } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getMarkerColor, getMarkerLabel, useWindowWidth } from '../utils/pdfHelpers';
import { saveDocument } from '../services/dbService';

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
  // Expose the logout function from auth context
  const { logout } = useAuth();

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

  // Confirm the pending customText box by attaching the admin's label and adding it to markers
  const confirmPendingBox = () => {
    if (!pendingBox || !pendingLabel.trim()) return;
    setMarkers((prev) => [...prev, { ...pendingBox, label: pendingLabel.trim() }]);
    setPendingBox(null);
    setPendingLabel('');
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a PDF file first.');
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

      // Step 2 — save the structured document record and markers to Firestore
      await saveDocument(fileId, `pdfs/${fileId}.pdf`, markers);

      // 3. Generate and display the Link
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

          {/* Field type selector — choose a type, then drag a box on the document */}
          <div className="field-type-selector">
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
          </div>
          {activeFieldType === 'customText' && (
            <p style={{ fontSize: '0.82rem', color: '#2563eb', marginBottom: 8, marginTop: -4 }}>
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
              Total Fields Placed:{' '}
              <span className="action-footer-count">{markers.length}</span>
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