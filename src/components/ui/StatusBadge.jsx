import React from 'react';

/** Status lifecycle badge with color-coded styling */
export default function StatusBadge({ status }) {
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
