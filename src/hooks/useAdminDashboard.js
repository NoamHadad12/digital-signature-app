import { useState, useEffect } from 'react';
import { getFilteredDocuments, deleteDocument, editDocumentName } from '../services/dbService';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';

export function useAdminDashboard() {
  const { currentUser, logout, userProfile } = useAuth();
  const { showToast, confirm } = useNotification();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [editDocId, setEditDocId] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [copiedId, setCopiedId] = useState(null);

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
    const isConfirmed = await confirm({
      title: 'Delete Document',
      description: `Are you sure you want to permanently delete "${docObj.fileName}"?`,
      confirmText: 'Delete',
      confirmVariant: 'danger'
    });
    if (!isConfirmed) return;

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

  const handleCleanupOldDocuments = async () => {
    const isConfirmed = await confirm({
      title: 'Cleanup Old Documents',
      description: 'Are you sure you want to permanently delete all documents older than 30 days? This action cannot be undone and will remove files from storage.',
      confirmText: 'Cleanup',
      confirmVariant: 'danger'
    });
    
    if (!isConfirmed) return;

    setLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffIso = thirtyDaysAgo.toISOString();

      const allDocs = await getFilteredDocuments(currentUser?.uid, '', '');
      const oldDocs = allDocs.filter((d) => (d.createdAt || '') < cutoffIso);

      let deletedCount = 0;
      for (const docObj of oldDocs) {
        await deleteDocument(docObj.id, docObj);
        deletedCount++;
      }

      showToast(`Successfully removed ${deletedCount} old document(s).`, 'success');
      fetchDocuments();
    } catch (err) {
      console.error(err);
      showToast('Failed to cleanup old documents', 'error');
    } finally {
      setLoading(false);
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
    handleEditSubmit,
    handleCleanupOldDocuments
  };
}
