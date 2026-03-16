import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { storage, db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { useWindowWidth } from '../utils/pdfHelpers';
import { detectFieldsWithGemini } from '../services/geminiFieldDetection';
import { convertImageToPdf } from '../utils/imageToPdf';

const ACCEPTED_UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']);
const IMAGE_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export const FIELD_TYPES = [
  { key: 'signature',  label: 'Signature',     type: 'signature',  color: '#e53e3e' },
  { key: 'date',       label: 'Date',           type: 'date',       color: '#059669' },
  { key: 'customText', label: '+ Custom Field', type: 'customText', color: '#2563eb' },
];

export function useUploadView() {
  const navigate = useNavigate();
  const { logout, currentUser, userProfile } = useAuth();
  const { showToast } = useNotification();
  
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [numPages, setNumPages] = useState(null);
  
  const [fields, setFields] = useState([]);
  const [activeFieldType, setActiveFieldType] = useState('signature');
  const [uploading, setUploading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Security Settings: Phase 1 (SMS 2FA)
  const [useSmsAuth, setUseSmsAuth] = useState(false);
  const [signerPhone, setSignerPhone] = useState('+972');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Ref-based guard prevents a second request from firing while one is already in flight,
  // even if the disabled button state is briefly bypassed (e.g. rapid keyboard activation).
  const analyzingRef = useRef(false);
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

  const resetUploadSelection = (selectedFile) => {
    setFile(selectedFile);
    setGeneratedLink('');
    setIsCopied(false);
    setFields([]);
    setFileUrl(selectedFile ? URL.createObjectURL(selectedFile) : null);
  };

  const prepareFileForPipeline = async (selectedFile) => {
    if (!selectedFile) {
      return null;
    }

    if (!ACCEPTED_UPLOAD_TYPES.has(selectedFile.type)) {
      showToast('Unsupported file type. Please upload a PDF, JPG, or PNG file.', 'error');
      return null;
    }

    if (selectedFile.size > MAX_UPLOAD_SIZE_BYTES) {
      showToast('File is too large! Maximum allowed size is 10MB.', 'error');
      return null;
    }

    // Adapter pattern: normalize image uploads into a PDF file before entering the existing flow.
    const normalizedFile = IMAGE_UPLOAD_TYPES.has(selectedFile.type)
      ? await convertImageToPdf(selectedFile)
      : selectedFile;

    if (normalizedFile.size > MAX_UPLOAD_SIZE_BYTES) {
      showToast('Converted PDF is too large! Maximum allowed size is 10MB.', 'error');
      return null;
    }

    return normalizedFile;
  };

  const handleFileChange = async (e) => {
    const input = e.target;
    const selectedFile = input.files?.[0] || null;

    try {
      const pipelineReadyFile = await prepareFileForPipeline(selectedFile);
      if (!selectedFile || !pipelineReadyFile) {
        if (!pipelineReadyFile) input.value = '';
        if (!selectedFile) resetUploadSelection(null);
        return;
      }

      resetUploadSelection(pipelineReadyFile);
    } catch (error) {
      console.error('Image to PDF conversion failed:', error);
      showToast('Failed to convert image to PDF. Please try another file.', 'error');
      input.value = '';
    }
  };

  const handleDropZoneDragOver = (e) => {
    e.preventDefault();
  };

  const handleFileDrop = async (e) => {
    e.preventDefault();
    const selectedFile = e.dataTransfer?.files?.[0] || null;

    try {
      const pipelineReadyFile = await prepareFileForPipeline(selectedFile);
      if (!pipelineReadyFile) {
        return;
      }

      resetUploadSelection(pipelineReadyFile);
    } catch (error) {
      console.error('Image to PDF conversion failed:', error);
      showToast('Failed to convert image to PDF. Please try another file.', 'error');
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
    // Prevent double-submission if a request is already in flight.
    if (!file || analyzingRef.current) return;
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setFields((prev) => prev.filter((f) => f.confirmed));

    try {
      const detectedFields = await detectFieldsWithGemini(file);

      if (detectedFields.length === 0) {
        showToast("AI couldn't find fields, please add manually.", 'info');
        return;
      }

      setFields((prev) => [
        ...prev,
        ...detectedFields,
      ]);
    } catch (error) {
      console.error('[AI] Analysis error:', error);
      const msg = error.message || '';
      if (error.status === 429 || msg.includes('429') || /quota/i.test(msg)) {
        showToast('Daily Limit Reached. The AI has reached its free-tier limit. Please wait about 60 seconds and try again.', 'error');
      } else if (msg.includes('VITE_GEMINI_API_KEY')) {
        showToast('Gemini is not configured yet. Add VITE_GEMINI_API_KEY and try again.', 'error');
      } else {
        showToast('Oops! We hit a small snag while trying to read your document. Please give it another try.', 'error');
      }
    } finally {
      analyzingRef.current = false;
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

    // Only save phone number if SMS auth is enabled
    const finalPhone = useSmsAuth ? signerPhone.trim() : '';

    await setDoc(documentRef, {
      fileName,
      fileUrl,
      originalPdfUrl: fileUrl,
      fileRef: `pdfs/${fileId}.pdf`,
      clientId:  currentUser.uid,
      createdAt: new Date().toISOString(),
      signerPhone: finalPhone,
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
      showToast('Please select a document file first.', 'error');
      return;
    }

    // Validate SMS authentication fields
    if (useSmsAuth && !signerPhone.trim()) {
      showToast('Please enter a valid phone number for SMS Authentication.', 'error');
      return;
    }

    const confirmedFields  = fields.filter((f) => f.confirmed);
    const pendingFields    = fields.filter((f) => !f.confirmed);
    if (confirmedFields.length === 0 && pendingFields.length > 0) {
      showToast(`You have ${pendingFields.length} pending AI suggestions. Please approve or reject them before uploading.`, 'error');
      return;
    }
    if (confirmedFields.length === 0) {
      showToast('Please drag on the document to place at least one field.', 'error');
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
      showToast('Upload Successful!', 'success');
    } catch (error) {
      console.error("=== FIREBASE UPLOAD ERROR ===");
      console.error(error);
      console.error("Error Code:", error?.code);
      console.error("Error Message:", error?.message);
      showToast(`Upload failed: ${error?.message || "Unknown error occurred."}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink).then(() => {
      setIsCopied(true);
      showToast('Link copied to clipboard!', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    }, (err) => {
      console.error('Failed to copy link: ', err);
      showToast('Failed to copy link', 'error');
    });
  };

  const shareOnWhatsApp = () => {
    const message = `היי! נשלח אליך מסמך חשוב לחתימה דרך מערכת SignFlow המאובטחת. אנא לחץ על הקישור למטה כדי לצפות ולחתום עליו בצורה קלה ומהירה. ${generatedLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  return {
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
    rejectSuggestion,
    approveAll,
    confirmPendingBox,
    handleUpload,
    copyToClipboard,
    shareOnWhatsApp,
  };
}