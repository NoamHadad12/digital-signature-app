/* eslint-disable react-hooks/refs */
import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { getMarkerColor } from '../utils/pdfHelpers';
import { useUploadView, FIELD_TYPES } from '../hooks/useUploadView';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const UploadView = () => {
  const {
    navigate,
    logout,
    userProfile,
    fileUrl,
    generatedLink,
    isCopied,
    numPages,
    useSmsAuth,
    setUseSmsAuth,
    signerPhone,
    setSignerPhone,
    fields,
    setFields,
    activeFieldType,
    setActiveFieldType,
    uploading,
    isAnalyzing,
    editingSuggestionId,
    setEditingSuggestionId,
    editingLabel,
    setEditingLabel,
    windowWidth,
    isDrawing,
    currentPageRef,
    drawingBox,
    interaction,
    setInteraction,
    pendingBox,
    setPendingBox,
    pendingLabel,
    setPendingLabel,
    handleFileChange,
    handleDropZoneDragOver,
    handleFileDrop,
    handleDocumentLoadSuccess,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handlePointerMove,
    handleRemoveField,
    handleAnalyze,
    approveSuggestion,
    approveAll,
    confirmPendingBox,
    handleUpload,
    copyToClipboard,
    shareOnWhatsApp,
  } = useUploadView();

  return (
    <div className="upload-view">
      {/* Header bar — spans full width, greeting on the left, action buttons on the right */}
      <div
        className="flex items-center justify-between"
        style={{ position: 'absolute', top: '16px', left: '16px', right: '16px' }}
      >
        {/* Greeting — top-left */}
        <span className="text-slate-600 font-semibold text-sm">
          {userProfile?.firstName ? `Hello ${userProfile.firstName}` : ''}
        </span>

        {/* Action buttons — top-right */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin')}
            className="btn btn-primary"
            style={{ padding: '6px 16px', fontSize: '0.82rem', margin: 0 }}
          >
            Admin Dashboard
          </button>
          <button
            onClick={logout}
            className="btn btn-secondary"
            style={{ padding: '6px 16px', fontSize: '0.82rem', margin: 0 }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <img
        src="/logo.png"
        alt="SignFlow logo"
        style={{
          width: 'min(450px, 85vw)',
          height: 'auto',
          display: 'block',
          margin: '10px auto 30px auto',
        }}
      />
      <p className="subtitle">Drop your document here</p>
      
      <div
        className="drop-zone"
        onDragOver={handleDropZoneDragOver}
        onDrop={handleFileDrop}
      >
        <p className="drop-zone-title">Drop your document here</p>
        <p className="drop-zone-support">Supports PDF, JPG, and PNG files</p>
        <input 
          type="file" 
          accept="application/pdf, image/png, image/jpeg" 
          onChange={handleFileChange} 
          className="file-input"
        />
      </div>

      {fileUrl && !generatedLink && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '16px 20px',
          marginTop: '20px',
          textAlign: 'left',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '12px', marginTop: 0 }}>
            <span style={{ marginRight: '8px' }}>🛡️</span>
            Security Settings
          </h3>
          
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: useSmsAuth ? '12px' : '0' }}>
            <input
              type="checkbox"
              id="sms-auth-toggle"
              checked={useSmsAuth}
              onChange={(e) => setUseSmsAuth(e.target.checked)}
              style={{ width: '16px', height: '16px', marginRight: '10px', cursor: 'pointer', accentColor: '#7c3aed' }}
            />
            <label htmlFor="sms-auth-toggle" style={{ fontSize: '0.9rem', color: '#4b5563', cursor: 'pointer', fontWeight: 500 }}>
              Protect with SMS Authentication
            </label>
          </div>

          {useSmsAuth && (
            <div style={{ paddingLeft: '26px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', fontWeight: 600, marginBottom: '6px' }}>
                Signer's Phone Number
              </label>
              <input
                type="tel"
                value={signerPhone}
                onChange={(e) => setSignerPhone(e.target.value)}
                placeholder="+972"
                style={{
                  width: '100%',
                  maxWidth: '300px',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
              />
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '6px', marginBottom: 0 }}>
                An SMS code will be required to view and sign the document.
              </p>
            </div>
          )}
        </div>
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
              <span>🤖 The AI detected <strong>{fields.filter((f) => !f.confirmed).length}</strong> fields! Drag them from the left side to the correct place on the document, then click Approve.</span>
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
                    onPointerMove={handlePointerMove}
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
                            // Position the center of the box at the detected point,
                            // then shift back by half the element's own size so the
                            // detected coordinate sits exactly at the box center.
                            left:            `${(field.nx + field.nw / 2) * 100}%`,
                            top:             `${(field.ny + field.nh / 2) * 100}%`,
                            transform:       'translate(-50%, -50%)',
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
    </div>
  );
};

export default UploadView;