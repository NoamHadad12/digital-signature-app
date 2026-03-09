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
    const isGhost = docObj._isGhost;

    const isConfirmed = await confirm({
      title: isGhost ? 'Delete Ghost Record' : (isSigned ? 'Delete Signed Document' : 'Delete Document'),
      description: isGhost
        ? `This record appears to be corrupted or incomplete. Delete "${docObj.fileName || docObj.id}"?`
        : `Are you sure you want to permanently delete "${docObj.fileName}"?${isSigned ? '\nWARNING: This document has already been signed!' : ''}`,
      confirmText: 'Delete',
      confirmVariant: 'danger'
    });
    if (!isConfirmed) return;

    setDeletingIds(prev => new Set(prev).add(docObj.id));
    try {
      await deleteDocument(docObj.id, docObj);
      // DO NOT manually update state here — onSnapshot handles it as the single source of truth
      showToast('Document and associated files permanently deleted.');
    } catch (err) {
      console.error('[handleDelete] Deletion failed:', err);
      showToast(`Failed to delete document: ${err.message || 'Unknown error'}`, 'error');
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
    // Count ghost records for the confirmation message
    const ghostCount = documents.filter(d => d._isGhost).length;
    
    const isConfirmed = await confirm({
      title: 'Cleanup Documents',
      description: `This will permanently delete:\n• All documents older than 30 days\n• ${ghostCount} ghost/corrupted records\n\nThis action cannot be undone.`,
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
      
      // Include both old docs AND ghost records
      const docsToDelete = allDocs.filter((d) => 
        (d.createdAt || '') < cutoffIso || d._isGhost
      );

      let deletedCount = 0;
      let failedCount = 0;
      
      for (const docObj of docsToDelete) {
        try {
          await deleteDocument(docObj.id, docObj);
          deletedCount++;
        } catch (err) {
          console.error(`[handleCleanupOldDocuments] Failed to delete ${docObj.id}:`, err);
          failedCount++;
        }
      }

      if (failedCount > 0) {
        showToast(`Cleanup complete: ${deletedCount} deleted, ${failedCount} failed.`, 'warning');
      } else {
        showToast(`Cleanup complete: removed ${deletedCount} documents.`, 'success');
      }
    } catch (err) {
      console.error('[handleCleanupOldDocuments] Cleanup failed:', err);
      showToast('Failed to cleanup documents.', 'error');
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
