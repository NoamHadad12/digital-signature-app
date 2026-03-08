import React, { useState, useEffect } from 'react';
import { getFilteredDocuments, deleteDocument, editDocumentName } from '../services/dbService';

export default function AdminDashboard() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clientIdFilter, setClientIdFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // State for Toast messages
  const [toast, setToast] = useState(null);

  // State for Edit Modal
  const [isEditing, setIsEditing] = useState(false);
  const [editDocId, setEditDocId] = useState(null);
  const [newFileName, setNewFileName] = useState('');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const results = await getFilteredDocuments(clientIdFilter, startDate, endDate);
      setDocuments(results);
    } catch (error) {
      console.error(error);
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
    setClientIdFilter('');
    setStartDate('');
    setEndDate('');
    fetchDocuments();
  };

  const handleDelete = async (docObj) => {
    if (!window.confirm(`Are you sure you want to delete "${docObj.fileName}"?`)) return;
    try {
      await deleteDocument(docObj.id, docObj);
      showToast('Document deleted successfully', 'success');
      fetchDocuments();
    } catch (error) {
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
      showToast('Document renamed successfully', 'success');
      setIsEditing(false);
      fetchDocuments();
    } catch (error) {
      showToast('Failed to edit document', 'error');
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Admin Dashboard</h1>
        <button 
          onClick={() => window.location.href = '/'}
          className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded"
        >
          Go to Upload View
        </button>
      </div>

      {toast && (
        <div className={`fixed top-4 right-4 p-4 rounded shadow-lg text-white ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.message}
        </div>
      )}

      {/* Filter Section */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4 text-gray-700">Filter Documents</h2>
        <form onSubmit={handleFilter} className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col">
            <label className="text-sm text-gray-600 mb-1">Client ID</label>
            <input 
              type="text" 
              value={clientIdFilter} 
              onChange={(e) => setClientIdFilter(e.target.value)} 
              placeholder="e.g. CLI-123"
              className="border p-2 rounded focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-600 mb-1">Start Date</label>
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
              className="border p-2 rounded focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-600 mb-1">End Date</label>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
              className="border p-2 rounded focus:ring-blue-500"
            />
          </div>
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
            Apply Filters
          </button>
          <button type="button" onClick={clearFilters} className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded">
            Clear
          </button>
        </form>
      </div>

      {/* Documents Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow-md">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="py-3 px-4 text-sm font-semibold text-gray-700">File Name</th>
              <th className="py-3 px-4 text-sm font-semibold text-gray-700">Client ID</th>
              <th className="py-3 px-4 text-sm font-semibold text-gray-700">Created At</th>
              <th className="py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" className="text-center py-6 text-gray-500">Loading documents...</td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan="4" className="text-center py-6 text-gray-500">No documents found.</td>
              </tr>
            ) : (
              documents.map((docObj) => (
                <tr key={docObj.id} className="border-b hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-800">{docObj.fileName}</td>
                  <td className="py-3 px-4 text-gray-600">{docObj.clientId || 'N/A'}</td>
                  <td className="py-3 px-4 text-gray-600">{new Date(docObj.createdAt).toLocaleString()}</td>
                  <td className="py-3 px-4 space-x-2">
                    <button 
                      onClick={() => openEditModal(docObj)}
                      className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded text-sm"
                    >
                      Edit Name
                    </button>
                    <button 
                      onClick={() => handleDelete(docObj)}
                      className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-lg w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Edit Document Name</h2>
            <input 
              type="text" 
              value={newFileName} 
              onChange={(e) => setNewFileName(e.target.value)} 
              className="w-full border p-2 rounded mb-4 focus:ring-blue-500 focus:border-blue-500"
              placeholder="New file name"
            />
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => setIsEditing(false)}
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded"
              >
                Cancel
              </button>
              <button 
                onClick={handleEditSubmit}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
