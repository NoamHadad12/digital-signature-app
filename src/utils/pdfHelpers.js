// Shared PDF marker utilities used by both UploadView and SignerView.
// Centralising these here prevents duplication and makes future changes easier.

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// getMarkerColor
// Returns the accent hex color for a marker based on its type.
// Red = signature, green = date, blue = custom text (with legacy subtype fallback).
// ---------------------------------------------------------------------------
export const getMarkerColor = (marker) => {
  if (!marker.type || marker.type === 'signature') return '#e53e3e';
  if (marker.type === 'date' || marker.subtype === 'date') return '#059669';
  // Legacy subtype colors for documents saved before the type field existed
  const LEGACY = { firstName: '#2563eb', lastName: '#7c3aed' };
  return LEGACY[marker.subtype] || '#2563eb';
};

// ---------------------------------------------------------------------------
// getMarkerLabel
// Returns the human-readable label shown inside the marker box on the PDF.
// Supports both the current schema (type field) and the legacy schema (subtype field).
// ---------------------------------------------------------------------------
export const getMarkerLabel = (marker) => {
  if (!marker.type || marker.type === 'signature') return 'Sign Here';
  if (marker.type === 'date' || marker.subtype === 'date') return 'Date';
  if (marker.type === 'customText') return marker.label || 'Custom Field';
  // Legacy subtype-based labels
  if (marker.subtype === 'firstName') return 'First Name';
  if (marker.subtype === 'lastName')  return 'Last Name';
  return 'Field';
};

// ---------------------------------------------------------------------------
// getMarkerKey
// Returns the stable key used inside the fieldValues map for text-type markers.
// Signature markers return null because they are handled separately via the canvas.
// ---------------------------------------------------------------------------
export const getMarkerKey = (marker) => {
  if (!marker.type || marker.type === 'signature') return null;
  if (marker.type === 'date' || marker.subtype === 'date') return '__date__';
  if (marker.type === 'customText') return marker.label || 'custom';
  // Legacy subtype-based keys
  if (marker.subtype === 'firstName') return 'First Name';
  if (marker.subtype === 'lastName')  return 'Last Name';
  return marker.subtype || 'field';
};

// ---------------------------------------------------------------------------
// useWindowWidth
// Custom hook that listens to window resize events and returns the current width.
// Both UploadView and SignerView use this to scale PDF pages responsively.
// ---------------------------------------------------------------------------
export const useWindowWidth = () => {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    // Remove the listener on unmount to prevent memory leaks
    return () => window.removeEventListener('resize', handler);
  }, []);

  return width;
};
