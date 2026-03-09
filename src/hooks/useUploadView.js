import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage, db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { useWindowWidth } from '../utils/pdfHelpers';

export const FIELD_TYPES = [
  { key: 'signature',  label: 'Signature',     type: 'signature',  color: '#e53e3e' },
  { key: 'date',       label: 'Date',           type: 'date',       color: '#059669' },
  { key: 'customText', label: '+ Custom Field', type: 'customText', color: '#2563eb' },
];

export function useUploadView() {
  const navigate = useNavigate();
  const { logout, currentUser, userProfile } = useAuth();
  
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileError, setFileError] = useState('');
  const [numPages, setNumPages] = useState(null);
  
  const [fields, setFields] = useState([]);
  const [activeFieldType, setActiveFieldType] = useState('signature');
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  const windowWidth = useWindowWidth();

  const [isDrawing, setIsDrawing] = useState(false);
  const [interaction, setInteraction] = useState({ index: null, type: null });
  const [drawStart, setDrawStart] = useState(null);
  const [drawingBox, setDrawingBox] = useState(null);
  
  const currentPageRef = useRef(null);
  const pageRectRef = useRef(null);

  const [pendingBox, setPendingBox] = useState(null);
  const [pendingLabel, setPendingLabel] = useState('');

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (selectedFile && selectedFile.size > 10 * 1024 * 1024) {
      setFileError('File is too large! Maximum allowed size is 10MB.');
      e.target.value = '';
      return;
    }

    setFileError('');
    setFile(selectedFile);
    setGeneratedLink('');
    setIsCopied(false);
    setFields([]);
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

  const handleMouseMove = (e, pageNumber) => {
    if (!isDrawing || pageNumber !== currentPageRef.current || !pageRectRef.current) return;
    const rect = pageRectRef.current;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setDrawingBox({
      nx: Math.min(drawStart.nx, nx),
      ny: Math.min(drawStart.ny, ny),
      nw: Math.abs(nx - drawStart.nx),
      nh: Math.abs(ny - drawStart.ny),
    });
  };

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
    
    if (boxNw > 0.01 && boxNh > 0.01) {
      const ft = FIELD_TYPES.find((f) => f.key === activeFieldType) || FIELD_TYPES[0];
      if (ft.type === 'customText') {
        setPendingBox({ type: ft.type, page: pageNumber, nx: boxNx, ny: boxNy, nw: boxNw, nh: boxNh });
        setPendingLabel('');
      } else {
        setFields((prev) => [
          ...prev,
          { id: crypto.randomUUID(), type: ft.type, page: pageNumber, nx: boxNx, ny: boxNy, nw: boxNw, nh: boxNh, confirmed: true },
        ]);
      }
    }
  };

  const handlePointerMove = (e) => {
    if (interaction.index === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const curNx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const curNy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== interaction.index) return f;
        if (interaction.type === 'move') return { ...f, nx: curNx, ny: curNy };
        const newNw = Math.max(0.05, Math.min(1 - f.nx, curNx - f.nx));
        const newNh = Math.max(0.02, Math.min(1 - f.ny, curNy - f.ny));
        return { ...f, nw: newNw, nh: newNh };
      })
    );
  };

  const handleRemoveField = (idToRemove) => {
    setFields((prev) => prev.filter((f) => f.id !== idToRemove));
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setAiError(null);
    setFields((prev) => prev.filter((f) => f.confirmed));

    try {
      const base64Pdf = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => {
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
        if (response.status === 429) {
          throw new Error('AI Quota Reached: The free tier limit has been exceeded. Please wait about 60 seconds and try again or use a smaller document.');
        }
        const err = await response.json();
        throw new Error(err.error || 'AI analysis failed.');
      }

      const { suggestions: raw } = await response.json();
      console.log("Suggestions received:", raw);

      if (!raw || raw.length === 0) {
        setAiError({
          title: 'No fields detected',
          description: "The AI couldn't automatically find signature or date fields on this document. Please add them manually using the buttons above.",
        });
        return;
      }

      const SAFE_WIDTH = 0.2;
      const SAFE_HEIGHT = 0.05;

      const mappedSuggestions = raw.map((s, index) => {
        // Check if coordinates are missing or explicitly near 0/0
        const needsOffset = !s.nx || !s.ny || (s.nx < 0.01 && s.ny < 0.01);
        
        return {
          ...s,
          id: crypto.randomUUID(),
          confirmed: false,
          // Apply a staircase offset (e.g., move down by 0.08 for each subsequent field)
          nx: needsOffset ? 0.1 : s.nx,
          ny: needsOffset ? (0.1 + (index * 0.08)) : s.ny,
          nw: s.nw || SAFE_WIDTH,
          nh: s.nh || SAFE_HEIGHT,
        };
      });

      setFields((prev) => [
        ...prev,
        ...mappedSuggestions,
      ]);
    } catch (error) {
      console.error('[AI] Analysis error:', error);
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

  const rejectSuggestion = (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (editingSuggestionId === id) setEditingSuggestionId(null);
  };

  const approveAll = () => {
    setFields((prev) => prev.map((f) => ({ ...f, confirmed: true })));
    setEditingSuggestionId(null);
  };

  const confirmPendingBox = () => {
    if (!pendingBox || !pendingLabel.trim()) return;
    setFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), ...pendingBox, label: pendingLabel.trim(), confirmed: true },
    ]);
    setPendingBox(null);
    setPendingLabel('');
  };

  const saveDocumentToFirestore = async (fileId, fileName, fileUrl, confirmedFields) => {
    const documentRef = doc(db, 'documents', fileId);

    await setDoc(documentRef, {
      fileName,
      fileUrl,
      clientId:  currentUser.uid,
      createdAt: new Date().toISOString(),
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
      const storageRef = ref(storage, `pdfs/${fileId}.pdf`);
      await uploadBytes(storageRef, file);
      const fileUrl = await getDownloadURL(storageRef);

      await saveDocumentToFirestore(fileId, file.name, fileUrl, confirmedFields);

      const link = `${window.location.origin}/sign/${fileId}`;
      setGeneratedLink(link);
    } catch (error) {
      console.error("=== FIREBASE UPLOAD ERROR ===");
      console.error(error);
      console.error("Error Code:", error?.code);
      console.error("Error Message:", error?.message);
      alert(`Upload failed: ${error?.message || "Unknown error occurred. Check browser console."}`);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }, (err) => {
      console.error('Failed to copy link: ', err);
    });
  };

  const shareOnWhatsApp = () => {
    const message = `You've been sent a document to sign: ${generatedLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  return {
    navigate,
    logout,
    userProfile,
    fileError,
    fileUrl,
    generatedLink,
    isCopied,
    numPages,
    fields,
    setFields,
    activeFieldType,
    setActiveFieldType,
    uploading,
    isAnalyzing,
    setAiError,
    aiError,
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
    handleDocumentLoadSuccess,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handlePointerMove,
    handleRemoveField,
    handleAnalyze,
    approveSuggestion,
    rejectSuggestion,
    approveAll,
    confirmPendingBox,
    handleUpload,
    copyToClipboard,
    shareOnWhatsApp,
  };
}