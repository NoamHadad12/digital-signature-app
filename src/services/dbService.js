// Firestore database service.
// All direct Firestore reads and writes are encapsulated here so the
// components stay focused on UI and never import firebase/firestore directly.
//
// Firestore schema
// ────────────────
// Collection : documents
//   Document : {documentId}          (one per uploaded PDF)
//     fileRef      string            Storage path, e.g. "pdfs/{id}.pdf"
//     createdAt    string            ISO-8601 timestamp of the upload
//     aiStatus     string            AI processing lifecycle:
//                                    'pending' → 'processing' → 'done' | 'error'
//     metadata     object            Reserved for future AI enrichment fields
//
//   Sub-collection : markers         (one document per field box)
//     index   number                 Original draw order — used to align formValues in the API
//     type    string                 'signature' | 'date' | 'customText'
//     page    number                 1-based page number within the PDF
//     nx      number                 Normalised X position (0–1 from the left edge)
//     ny      number                 Normalised Y position (0–1 from the top edge)
//     nw      number                 Normalised width  (0–1)
//     nh      number                 Normalised height (0–1)
//     label   string?               Only present on customText markers

import { db, storage } from '../firebase';
import {
  doc,
  setDoc,
  collection,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { logAction } from '../utils/logger';

// ---------------------------------------------------------------------------
// saveDocument
// Writes a new document record and all of its markers to Firestore.
// Markers are stored in a sub-collection so they can be queried independently
// in the future (e.g. "find all signature fields across all documents").
//
// @param {string} fileId   - UUID that was used when uploading to Storage
// @param {string} fileRef  - Firebase Storage path ("pdfs/{fileId}.pdf")
// @param {Array}  markers  - Array of marker objects placed by the admin
// ---------------------------------------------------------------------------
export const saveDocument = async (fileId, fileRef, markers) => {
  const documentRef = doc(db, 'documents', fileId);

  // Step 1 — write the top-level document record
  await setDoc(documentRef, {
    fileRef,
    createdAt: new Date().toISOString(),

    // aiStatus tracks where this document sits in the AI processing pipeline.
    // Starts as 'pending'; an external function updates it as work progresses.
    aiStatus: 'pending',

    // metadata is a placeholder for fields that the AI pipeline will populate later,
    // such as page count, detected language, OCR output, or confidence scores.
    metadata: {
      pageCount:         null,
      detectedLanguage:  null,
      extractedText:     null,
      aiNotes:           null,
    },
  });

  // Step 2 — write each marker as a separate document inside the markers sub-collection
  const markersRef = collection(documentRef, 'markers');

  const markerPromises = markers.map((marker, index) =>
    addDoc(markersRef, {
      index,                            // Preserve the original draw order
      type:  marker.type || 'signature',
      page:  marker.page ?? 1,
      nx:    marker.nx,
      ny:    marker.ny,
      nw:    marker.nw,
      nh:    marker.nh,
      // Only include label when it is present (customText markers only)
      ...(marker.label ? { label: marker.label } : {}),
    })
  );

  await Promise.all(markerPromises);
};

// ---------------------------------------------------------------------------
// fetchDocument
// Loads a document record and its markers from Firestore.
// Checks the new sub-collection schema first, then falls back to the two
// legacy formats so old documents continue to work without a migration.
//
// @param  {string} documentId
// @returns {Promise<{ data: object, markers: Array } | null>}
// ---------------------------------------------------------------------------
export const fetchDocument = async (documentId) => {
  const documentRef = doc(db, 'documents', documentId);
  const docSnap = await getDoc(documentRef);

  if (!docSnap.exists()) return null;

  const data = docSnap.data();

  // Try the current sub-collection schema first
  const markersRef = collection(documentRef, 'markers');
  const markersSnap = await getDocs(markersRef);

  let markers = [];

  if (!markersSnap.empty) {
    // Current sub-collection schema: one Firestore doc per marker, sorted by index
    const raw = markersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    raw.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    markers = raw;
  } else if (Array.isArray(data.fields) && data.fields.length > 0) {
    // Current flat-array schema: written by UploadView as a `fields` array on the document
    markers = data.fields;
  } else if (Array.isArray(data.markers) && data.markers.length > 0) {
    // Legacy schema: markers stored as an array field directly on the document
    markers = data.markers;
  } else if (data.signatureCoords) {
    // Oldest legacy format: a single signatureCoords object on the document
    markers = [data.signatureCoords];
  }

  return { data, markers };
};

// ---------------------------------------------------------------------------
// getFilteredDocuments
// Fetches ONLY documents belonging to the current user (strict multi-tenant).
// The uid filter is mandatory — this is enforced both here and in Firestore rules.
//
// @param {string} uid        - The authenticated user's UID (currentUser.uid)
// @param {string} startDate  - Optional ISO date string lower bound
// @param {string} endDate    - Optional ISO date string upper bound
// ---------------------------------------------------------------------------
export const getFilteredDocuments = async (uid, startDate, endDate) => {
  if (!uid) return [];

  const docsRef = collection(db, 'documents');

  // Always enforce clientId == uid — privacy by design, no exceptions
  const constraints = [where('clientId', '==', uid)];

  if (startDate) {
    constraints.push(where('createdAt', '>=', new Date(startDate).toISOString()));
  }

  if (endDate) {
    const endDocDate = new Date(endDate);
    endDocDate.setHours(23, 59, 59, 999);
    constraints.push(where('createdAt', '<=', endDocDate.toISOString()));
  }

  constraints.push(orderBy('createdAt', 'desc'));

  const q = query(docsRef, ...constraints);
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// ---------------------------------------------------------------------------
// updateDocumentStatus
// Updates the lifecycle status of a document in Firestore.
// Also accepts optional extra fields (e.g. signedPdfUrl) to merge in the same write.
//
// @param {string} documentId
// @param {string} status       - 'draft' | 'sent' | 'opened' | 'signed'
// @param {object} extraFields  - Optional additional fields to merge
// ---------------------------------------------------------------------------
export const updateDocumentStatus = async (documentId, status, extraFields = {}) => {
  const documentRef = doc(db, 'documents', documentId);
  await updateDoc(documentRef, {
    status,
    ...extraFields,
    updatedAt: new Date().toISOString(),
  });
};

// ---------------------------------------------------------------------------
// deleteDocument
// Completely removes a document and its markers from Firestore, and the PDF
// from Storage, and logs the deletion.
// ---------------------------------------------------------------------------
export const deleteDocument = async (documentId, documentData) => {
  try {
    // 1. Delete actual PDF file from Firebase Storage
    const storagePath = documentData.fileRef || `pdfs/${documentId}.pdf`;
    const fileRef = ref(storage, storagePath);
    try {
      await deleteObject(fileRef);
    } catch (e) {
      console.warn('Storage file not found or already deleted', e);
    }
    
    // 2. Delete all associated markers in the sub-collection
    const documentRef = doc(db, 'documents', documentId);
    const markersRef = collection(documentRef, 'markers');
    const markersSnap = await getDocs(markersRef);
    const deletePromises = markersSnap.docs.map((markerDoc) => deleteDoc(markerDoc.ref));
    await Promise.all(deletePromises);
    
    // 3. Delete the document from Firestore
    await deleteDoc(documentRef);
    
    // 4. Log Action
    await logAction('delete_doc', documentId, { 
      fileName: documentData.fileName,
      clientId: documentData.clientId 
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// editDocumentName
// Updates the fileName of an existing document.
// ---------------------------------------------------------------------------
export const editDocumentName = async (documentId, newFileName) => {
  try {
    const documentRef = doc(db, 'documents', documentId);
    await updateDoc(documentRef, {
      fileName: newFileName
    });
    
    await logAction('edit_doc', documentId, {
      newFileName
    });
  } catch (error) {
    console.error('Error editing document name:', error);
    throw error;
  }
};
