import React, { useState } from 'react';
import { storage, db } from '../firebase';
import { ref, uploadBytes } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set the worker source from a reliable CDN to ensure compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const UploadView = () => {
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [signatureCoords, setSignatureCoords] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setGeneratedLink(''); // Reset link on new upload
    setIsCopied(false); // Reset copied state on new upload
    setSignatureCoords(null);
    
    if (selectedFile) {
      setFileUrl(URL.createObjectURL(selectedFile));
    } else {
      setFileUrl(null);
    }
  };

  const handleDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  const handlePageClick = (e, pageNumber) => {
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Calculate click coordinates relative to the page div
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Normalize coordinates to a percentage (0 to 1) for responsive scaling
    const nx = x / rect.width;
    const ny = y / rect.height;
    
    setSignatureCoords({ page: pageNumber, nx, ny });
  };

  const handleUpload = async () => {
    if (!file) {
      alert("Please select a PDF file first");
      return;
    }
    if (!signatureCoords) {
      alert("Please click anywhere on the document to place the signature marker.");
      return;
    }
    
    setUploading(true);
    setGeneratedLink(''); // Reset link on new upload
    setIsCopied(false); // Reset copied state on new upload
    const fileId = uuidv4();
    const storageRef = ref(storage, `pdfs/${fileId}.pdf`);

    try {
      // Upload the PDF to storage
      await uploadBytes(storageRef, file);
      
      // Save the placement coordinates and file reference into Firestore
      await setDoc(doc(db, "documents", fileId), {
        fileRef: `pdfs/${fileId}.pdf`,
        signatureCoords: signatureCoords,
        createdAt: new Date().toISOString()
      });

      // Use window.location.origin to create a robust link for any environment
      const link = `${window.location.origin}/sign/${fileId}`;
      setGeneratedLink(link);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
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

      {/* Render PDF Preview to select signature location */}
      {fileUrl && !generatedLink && (
        <div style={{ marginTop: '20px' }}>
          <p style={{ fontWeight: 600, color: 'var(--primary-color)', marginBottom: '15px' }}>
            Action Required: Click on the document to place the signature.
          </p>
          <div className="pdf-document-container" style={{ textAlign: 'center' }}>
            <Document 
              file={fileUrl} 
              onLoadSuccess={handleDocumentLoadSuccess}
              loading={<div>Loading PDF preview...</div>}
            >
              {Array.from(new Array(numPages), (el, index) => {
                const pageNumber = index + 1;
                return (
                  <div 
                    key={`page_${pageNumber}`} 
                    className="pdf-page-wrapper clickable"
                    onClick={(e) => handlePageClick(e, pageNumber)}
                  >
                    <Page 
                      pageNumber={pageNumber} 
                      width={Math.min(window.innerWidth - 80, 550)} 
                      renderTextLayer={false} 
                      renderAnnotationLayer={false} 
                    />
                    {/* Render visual placeholder based on normalized coordinates */}
                    {signatureCoords && signatureCoords.page === pageNumber && (
                      <div 
                        className="signature-marker" 
                        style={{
                          left: `${signatureCoords.nx * 100}%`,
                          top: `${signatureCoords.ny * 100}%`
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
          
          <button 
            onClick={handleUpload} 
            disabled={uploading || !signatureCoords}
            className="btn btn-primary"
            style={{ marginTop: '20px', width: '100%' }}
          >
            {uploading ? "Uploading Data..." : "Upload & Generate Link"}
          </button>
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