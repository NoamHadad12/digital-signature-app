import React, { useState, useEffect } from 'react';
import {
  Search,
  Calendar,
  SlidersHorizontal,
  X,
  Pencil,
  Trash2,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Link2,
  UploadCloud,
  LogOut,
} from 'lucide-react';
import { getFilteredDocuments, deleteDocument, editDocumentName } from '../services/dbService';
import { useAuth } from '../context/AuthContext';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format an ISO date string to a readable label, e.g. "Mar 8, 2026, 14:36" */
const formatDate = (iso) => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
};

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Animated toast notification that slides in from the top-right */
function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div
      className={`
        fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5
        rounded-xl shadow-2xl text-white text-sm font-medium
        transition-all duration-300
        ${isError ? 'bg-red-500' : 'bg-emerald-500'}
      `}
    >
      {isError
        ? <XCircle size={18} className="shrink-0" />
        : <CheckCircle2 size={18} className="shrink-0" />}
      {toast.message}
    </div>
  );
}

/** Status lifecycle badge with color-coded styling */
function StatusBadge({ status }) {
  const normalizedStatus = (status || 'draft').toLowerCase();
  const config = {
    draft:  { label: 'Draft',  cls: 'bg-gray-100 text-gray-600 ring-gray-200' },
    sent:   { label: 'Sent',   cls: 'bg-blue-100 text-blue-700 ring-blue-200' },
    opened: { label: 'Opened', cls: 'bg-amber-100 text-amber-700 ring-amber-200' },
    signed: { label: 'Signed', cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  };
  const { label, cls } = config[normalizedStatus] || config.draft;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  // Pull the authenticated user so we can scope all Firestore queries to their uid
  const { currentUser, logout, userProfile } = useAuth();

  // Toast state
  const [toast, setToast] = useState(null);

  // Edit-modal state
  const [isEditing,   setIsEditing]   = useState(false);
  const [editDocId,   setEditDocId]   = useState(null);
  const [newFileName, setNewFileName] = useState('');

  // ── Helpers ──────────────────────────────────────────────────────────────

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      // Always pass the current user's UID — strict tenant isolation
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

  // ── Filter handlers ───────────────────────────────────────────────────────

  const handleFilter = (e) => {
    e.preventDefault();
    fetchDocuments();
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    // Re-fetch with empty date range but keep the uid filter
    setLoading(true);
    getFilteredDocuments(currentUser?.uid, '', '')
      .then(setDocuments)
      .catch((err) => { console.error(err); showToast('Error fetching documents', 'error'); })
      .finally(() => setLoading(false));
  };

  // Tracks which document's link was most recently copied (for button feedback)
  const [copiedId, setCopiedId] = useState(null);

  // Rebuilds the public signing link and copies it to the clipboard
  const handleCopyLink = (docId) => {
    const link = `${window.location.origin}/sign/${docId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(docId);
      showToast('Signing link copied!');
      setTimeout(() => setCopiedId(null), 2500);
    }).catch(() => showToast('Failed to copy link', 'error'));
  };

  // ── CRUD handlers ─────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* Top Navigation Bar - sticky white header */}
      <header className="flex items-center justify-end gap-4 p-4 absolute top-0 right-0 w-full z-30">
        {userProfile?.firstName && (
          <span className="text-gray-600 font-medium text-sm" dir="rtl">
            {userProfile?.firstName ? `Hello ${userProfile.firstName}` : ''}
          </span>
        )}
        <button
          onClick={() => (window.location.href = '/')}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-all text-sm"
        >
          Upload Document
        </button>
        <button
          onClick={logout}
          className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg transition-all text-sm"
        >
          Sign Out
        </button>
      </header>

      {/* Page Content */}
      <main className="max-w-6xl mx-auto w-full bg-white rounded-2xl shadow-xl p-8 mt-8 border border-slate-100 relative top-16">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Document Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search, filter and manage all uploaded signing documents.
          </p>
        </div>

        {/* ── Filter Card ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <SlidersHorizontal size={17} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-800">Filters</h2>
          </div>

          <form onSubmit={handleFilter} className="flex flex-col sm:flex-row items-end gap-4">

            {/* Start Date with calendar icon */}
            <div className="flex flex-col gap-1 w-full sm:w-1/3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Start Date</label>
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                />
              </div>
            </div>

            {/* End Date with calendar icon */}
            <div className="flex flex-col gap-1 w-full sm:w-1/3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">End Date</label>
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm text-gray-800"
                />
              </div>
            </div>

            {/* Action buttons aligned to the bottom of the column */}
            <div className="flex items-center gap-2 w-full sm:w-1/3">
              <button
                type="submit"
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-all text-sm"
              >
                <Search size={15} />
                Search
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center justify-center gap-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg transition-all text-sm"
                title="Clear all filters"
              >
                <X size={15} />
                Clear
              </button>
            </div>

          </form>
        </div>

        {/* ── Table Card ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">

          {/* Table meta bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">
              Documents
              {!loading && (
                <span className="ml-2 text-xs font-normal text-gray-400">({documents.length} records)</span>
              )}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">

              {/* Sticky table header */}
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-100">
                  <th className="sticky top-0 p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    File Name
                  </th>
                  <th className="sticky top-0 p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="sticky top-0 p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Created At
                  </th>
                  <th className="sticky top-0 p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="bg-white">

                {/* Loading state */}
                {loading && (
                  <tr>
                    <td colSpan="4" className="p-4 text-center border-b border-slate-100">
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <Loader2 size={28} className="animate-spin text-blue-500" />
                        <span className="text-sm">Loading documents…</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Empty state */}
                {!loading && documents.length === 0 && (
                  <tr>
                    <td colSpan="4" className="p-4 text-center border-b border-slate-100">
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <div className="bg-gray-100 p-4 rounded-full">
                          <FileText size={28} className="text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">No documents found</p>
                        <p className="text-xs text-gray-400">Try adjusting your filters or upload a new document.</p>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {!loading && documents.map((docObj) => (
                  <tr
                    key={docObj.id}
                    className="group hover:bg-blue-50/50 transition-colors duration-100 border-b border-slate-100"
                  >
                    {/* File Name with document icon */}
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-50 p-1.5 rounded-md shrink-0">
                          <FileText size={14} className="text-blue-500" />
                        </div>
                        {docObj.signedPdfUrl ? (
                          <a 
                            href={docObj.signedPdfUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate max-w-xs cursor-pointer"
                            title="Download Signed PDF"
                          >
                            {docObj.fileName}
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-gray-800 truncate max-w-xs">
                            {docObj.fileName}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Lifecycle status badge */}
                    <td className="p-4">
                      <StatusBadge status={docObj.status} />
                    </td>

                    {/* Formatted date */}
                    <td className="p-4 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(docObj.createdAt)}
                    </td>

                    {/* Icon action buttons */}
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">

                        {((docObj.status || '').toLowerCase() === 'signed' && docObj.signedPdfUrl) ? (
                          <a
                            href={docObj.signedPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View signed PDF"
                            className="p-2 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors duration-150 flex items-center justify-center"
                          >
                            <ExternalLink size={16} />
                          </a>
                        ) : (
                          <button
                            onClick={() => handleCopyLink(docObj.id)}
                            title="Copy signing link"
                            className={`p-2 rounded-lg transition-colors duration-150 flex items-center justify-center
                              ${copiedId === docObj.id
                                ? 'text-emerald-600 bg-emerald-50'
                                : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                          >
                            {copiedId === docObj.id ? <CheckCircle2 size={16} /> : <Link2 size={16} />}
                          </button>
                        )}

                        {/* Rename document */}
                        <button
                          onClick={() => openEditModal(docObj)}
                          title="Rename document"
                          className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50
                                     transition-colors duration-150"
                        >
                          <Pencil size={16} />
                        </button>

                        {/* Permanently delete */}
                        <button
                          onClick={() => handleDelete(docObj)}
                          title="Delete document"
                          className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50
                                     transition-colors duration-150"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ── Toast Notification ──────────────────────────────────────────── */}
      <Toast toast={toast} />

      {/* ── Edit / Rename Modal ─────────────────────────────────────────── */}
      {isEditing && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsEditing(false)}
        >
          {/* Prevent click-through to the backdrop inside the card */}
          <div
            className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-amber-100 p-2 rounded-lg">
                <Pencil size={18} className="text-amber-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Rename Document</h2>
            </div>

            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              New File Name
            </label>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEditSubmit()}
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-800
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-6 transition"
              placeholder="document-name.pdf"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-300
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                className="px-5 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700
                           text-white rounded-lg shadow-sm transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
