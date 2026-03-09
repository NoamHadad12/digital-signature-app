import { useState, useEffect } from 'react';
import { subscribeFilteredDocuments, editDocumentName } from '../services/dbService';
import { doc, deleteDoc } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
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
      // 1. Extract storage paths
      const extractStoragePath = (urlOrPath) => {
        if (!urlOrPath) return null;
        if (!urlOrPath.startsWith('http')) return urlOrPath;
        try {
          const url = new URL(urlOrPath);
          const match = url.pathname.match(/\/o\/(.+)$/);
          if (match) return decodeURIComponent(match[1]);
        } catch {
          // ignore parsing errors
        }
        return urlOrPath;
      };

      const originalStoragePath = extractStoragePath(
        docObj.fileRef || docObj.originalPdfUrl || docObj.fileUrl
      ) || `pdfs/${docObj.id}.pdf`;

      const signedStoragePath = extractStoragePath(docObj.signedPdfUrl) ||
        ((docObj.status || '').toLowerCase() === 'signed' ? `pdfs/signed_${docObj.id}.pdf` : null);

      // 2. Best effort to delete from Storage (do not block Firestore deletion if this fails e.g 404)
      if (originalStoragePath) {
        try {
          await deleteObject(ref(storage, originalStoragePath));
        } catch (err) {
          console.warn('Storage file missing, proceeding to DB cleanup', err);
        }
      }

      if (signedStoragePath && signedStoragePath !== originalStoragePath) {
        try {
          await deleteObject(ref(storage, signedStoragePath));
        } catch (err) {
          console.warn('Storage file missing, proceeding to DB cleanup', err);
        }
      }

      // 3. Atomically delete the Firestore document (The single source of truth)
      await deleteDoc(doc(db, 'documents', docObj.id));

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
    handleEditSubmit
  };
}
