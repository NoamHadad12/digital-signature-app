import { useState, useEffect } from 'react';
import { getFilteredDocuments, deleteDocument, editDocumentName } from '../services/dbService';
import { useAuth } from '../context/AuthContext';

export function useAdminDashboard() {
  const { currentUser, logout, userProfile } = useAuth();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const [toast, setToast] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDocId, setEditDocId] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const results = await getFilteredDocuments(currentUser?.uid, startDate, endDate);
      setDocuments(results);
    } catch (err) {
      console.error(err);
      showToast('Error fetching documents', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilter = (e) => {
    e.preventDefault();
    fetchDocuments();
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setLoading(true);
    getFilteredDocuments(currentUser?.uid, '', '')
      .then(setDocuments)
      .catch((err) => { console.error(err); showToast('Error fetching documents', 'error'); })
      .finally(() => setLoading(false));
  };

  const handleCopyLink = (docId) => {
    const link = `${window.location.origin}/sign/${docId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(docId);
      showToast('Signing link copied!');
      setTimeout(() => setCopiedId(null), 2500);
    }).catch(() => showToast('Failed to copy link', 'error'));
  };

  const handleDelete = async (docObj) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${docObj.fileName}"?`)) return;
    try {
      await deleteDocument(docObj.id, docObj);
      showToast('Document deleted successfully');
      fetchDocuments();
    } catch {
      showToast('Failed to delete document', 'error');
    }
  };

  const openEditModal = (docObj) => {
    setEditDocId(docObj.id);
    setNewFileName(docObj.fileName || '');
    setIsEditing(true);
  };

  const handleEditSubmit = async () => {
    if (!newFileName.trim()) {
      showToast('File name cannot be empty', 'error');
      return;
    }
    try {
      await editDocumentName(editDocId, newFileName);
      showToast('Document renamed successfully');
      setIsEditing(false);
      fetchDocuments();
    } catch {
      showToast('Failed to rename document', 'error');
    }
  };

  return {
    currentUser,
    userProfile,
    logout,
    documents,
    loading,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    toast,
    isEditing,
    setIsEditing,
    editDocId,
    newFileName,
    setNewFileName,
    copiedId,
    handleFilter,
    clearFilters,
    handleCopyLink,
    handleDelete,
    openEditModal,
    handleEditSubmit
  };
}
