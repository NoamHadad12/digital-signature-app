import { useState, useEffect } from 'react';
import { subscribeFilteredDocuments, getFilteredDocuments, editDocumentName, deleteDocument } from '../services/dbService';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';

export function useAdminDashboard() {
  const { currentUser, logout, userProfile } = useAuth();
  const { showToast, confirm } = useNotification();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading]     = useState(false);
  
  // These are the inputs in the UI
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  // These are the currently applied filters for the subscription
  const [appliedFilters, setAppliedFilters] = useState({ start: '', end: '' });

  const [isEditing, setIsEditing] = useState(false);
  const [editDocId, setEditDocId] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  
  // Track deleting documents for loading spinner
  const [deletingIds, setDeletingIds] = useState(new Set());

  useEffect(() => {
    if (!currentUser?.uid) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    
    // Subscribe to real-time updates
    const unsubscribe = subscribeFilteredDocuments(
      currentUser.uid,
      appliedFilters.start,
      appliedFilters.end,
      (docs) => {
        setDocuments(docs);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        showToast('Error syncing documents', 'error');
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, appliedFilters]);

  const handleFilter = (e) => {
    e.preventDefault();
    setAppliedFilters({ start: startDate, end: endDate });
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setAppliedFilters({ start: '', end: '' });
  };

  const handleActionPreCheck = async (e, docId) => {
    const docExists = documents.find(d => d.id === docId);
    if (!docExists || !docExists.signedPdfUrl) {
      e.preventDefault();
      showToast('Document no longer exists', 'error');
    }
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
    const isSigned = (docObj.status || '').toLowerCase() === 'signed';
    const isConfirmed = await confirm({
      title: isSigned ? 'Delete Signed Document' : 'Delete Document',
      description: `Are you sure you want to permanently delete "${docObj.fileName}"?${isSigned ? '\nWARNING: This document has already been signed!' : ''}`,
      confirmText: 'Delete',
      confirmVariant: 'danger'
    });
    if (!isConfirmed) return;

    setDeletingIds(prev => new Set(prev).add(docObj.id));
    try {
      await deleteDocument(docObj.id, docObj);
      setDocuments((prev) => prev.filter((documentItem) => documentItem.id !== docObj.id));
      showToast('Document and associated files permanently deleted.');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete document', 'error');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(docObj.id);
        return next;
      });
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
      // No need to fetchDocuments(), managed by onSnapshot
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

      showToast(`Document and associated files permanently deleted. (Removed ${deletedCount} old documents)`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to cleanup old documents.', 'error');
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
    deletingIds,
    handleFilter,
    clearFilters,
    handleActionPreCheck,
    handleCopyLink,
    handleDelete,
    openEditModal,
    handleEditSubmit,
    handleCleanupOldDocuments
  };
}
