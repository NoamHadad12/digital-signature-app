import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

/** Animated toast notification that slides in from the top-right */
export default function Toast({ toast }) {
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
