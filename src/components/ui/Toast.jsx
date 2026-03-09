import React from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

/** Animated toast notification that slides in from the top-right */
export default function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === 'error';
  const isInfo = toast.type === 'info';
  
  let bgColor = 'bg-emerald-500';
  let Icon = CheckCircle2;
  
  if (isError) {
    bgColor = 'bg-red-500';
    Icon = XCircle;
  } else if (isInfo) {
    bgColor = 'bg-blue-500';
    Icon = Info;
  }

  return (
    <div
      className={`
        fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3.5
        rounded-xl shadow-2xl text-white text-sm font-medium
        transform transition-all duration-300 animate-in slide-in-from-top-5 fade-in
        ${bgColor}
      `}
    >
      <Icon size={18} className="shrink-0" />
      {toast.message}
    </div>
  );
}
