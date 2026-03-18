import React from 'react';
import {
  Search,
  Calendar,
  SlidersHorizontal,
  X,
  Pencil,
  Trash2,
  FileText,
  CheckCircle2,
  Loader2,
  Eye,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import StatusBadge from './ui/StatusBadge';
import { useAdminDashboard } from '../hooks/useAdminDashboard';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format an ISO date string to a readable label */
const formatDate = (iso) => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const {
    activeTab,
    setActiveTab,
    users,
    loadingUsers,
    handleApproveUser,
    handleRevokeUser,
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
  } = useAdminDashboard();

  return (
    <div className="min-h-screen bg-slate-50 font-sans overflow-x-hidden">
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
      <main className="w-full px-4 sm:px-6 lg:px-8 mx-auto bg-white rounded-2xl shadow-xl py-6 mt-16 mb-20 border border-slate-100">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your workspace.
          </p>
        </div>

        {/* Dashboard Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('documents')}
            className={`pb-2 text-sm font-semibold transition-colors ${
              activeTab === 'documents'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Documents
          </button>
          {userProfile?.role === 'superAdmin' && (
            <button
              onClick={() => setActiveTab('users')}
              className={`pb-2 text-sm font-semibold transition-colors ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Users & Approvals
            </button>
          )}
        </div>

        {activeTab === 'documents' && (
          <>
        {/* ── Filter Card ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between gap-2 mb-5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={17} className="text-blue-600" />
              <h2 className="text-base font-semibold text-gray-800">Filters</h2>
            </div>
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
                  <th className="sticky top-0 right-0 p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right whitespace-nowrap bg-slate-50 shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.05)] z-20">
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
                    className={`group transition-colors duration-100 border-b border-slate-100
                      ${docObj._isGhost 
                        ? 'bg-red-50/50 hover:bg-red-100/50' 
                        : 'hover:bg-blue-50/50'}`}
                  >
                    {/* File Name with document icon */}
                    <td className="p-4 max-w-[200px] sm:max-w-[300px] md:max-w-[400px] truncate overflow-hidden whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-md shrink-0 ${docObj._isGhost ? 'bg-red-100' : 'bg-blue-50'}`}>
                          {docObj._isGhost 
                            ? <AlertTriangle size={14} className="text-red-500" />
                            : <FileText size={14} className="text-blue-500" />}
                        </div>
                        {docObj._isGhost ? (
                          <span 
                            className="text-sm font-medium text-red-600 truncate w-full cursor-default"
                            title="Ghost record - missing files or corrupted"
                          >
                            {docObj.fileName || `[Corrupted: ${docObj.id.slice(0, 8)}...]`}
                          </span>
                        ) : docObj.signedPdfUrl ? (
                          <a 
                            href={docObj.signedPdfUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => handleActionPreCheck(e, docObj.id)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate w-full cursor-pointer"
                            title={docObj.fileName}
                          >
                            {docObj.fileName}
                          </a>
                        ) : (
                          <span 
                            className="text-sm font-medium text-gray-800 truncate w-full cursor-default"
                            title={docObj.fileName}
                          >
                            {docObj.fileName}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Lifecycle status badge */}
                    <td className="p-4">
                      {docObj._isGhost 
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <AlertTriangle size={12} /> Ghost
                          </span>
                        : <StatusBadge status={docObj.status} />}
                    </td>

                    {/* Formatted date */}
                    <td className="p-4 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(docObj.createdAt)}
                    </td>

                    {/* Icon action buttons */}
                    <td className="p-4 sticky right-0 bg-white group-hover:bg-[#f3f8fe] shadow-[-4px_0_6px_-1px_rgba(0,0,0,0.05)] z-10">
                      <div className="flex items-center justify-end gap-1">

                        {((docObj.status || '').toLowerCase() === 'signed' && docObj.signedPdfUrl) ? (
                          <a
                            href={docObj.signedPdfUrl}
                            target="_blank"
                            onClick={(e) => handleActionPreCheck(e, docObj.id)}
                            rel="noopener noreferrer"
                            title="View signed PDF"
                            className="p-2 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors duration-150 flex items-center justify-center"
                          >
                            <Eye size={16} />
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
                          title="Permanently delete document"
                          disabled={deletingIds.has(docObj.id)}
                          className={`p-2 rounded-lg transition-colors duration-150 
                            ${deletingIds.has(docObj.id) 
                              ? 'text-gray-300 cursor-not-allowed' 
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                        >
                          {deletingIds.has(docObj.id) ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {activeTab === 'users' && userProfile?.role === 'superAdmin' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Users & Approvals
                {!loadingUsers && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({users.length} records)</span>
                )}
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-100">
                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {loadingUsers ? (
                    <tr>
                      <td colSpan="5" className="p-4 text-center">Loading...</td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-4 text-center text-gray-500">No users found.</td>
                    </tr>
                  ) : users.map(u => (
                    <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-4 text-sm font-medium text-gray-800">{u.firstName} {u.lastName}</td>
                      <td className="p-4 text-sm text-gray-600">{u.email}</td>
                      <td className="p-4 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.status?.toLowerCase() === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {u.status?.toLowerCase() === 'approved' ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-gray-600">{u.role}</td>
                      <td className="p-4 text-right">
                        {u.status?.toLowerCase() === 'pending' && (
                          <button
                            onClick={() => handleApproveUser(u.id)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors"
                          >
                            Approve
                          </button>
                        )}
                        {u.status?.toLowerCase() === 'approved' && u.role !== 'superAdmin' && (
                          <button
                            onClick={() => handleRevokeUser(u.id)}
                            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-colors ml-2"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

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
