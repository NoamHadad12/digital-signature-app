import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

/**
 * Logs major actions to the Firestore 'logs' collection.
 *
 * @param {string} actionType - 'create_doc' | 'sign_doc' | 'delete_doc' | 'edit_doc'
 * @param {string} documentId - The ID of the document being manipulated
 * @param {object} payload - Extra information about the action
 */
export const logAction = async (actionType, documentId, payload = {}) => {
  try {
    let ipAddress = 'unknown';
    // Attempt to grab IP if possible, though mostly relying on client-side fetch.
    try {
      const resp = await fetch('https://api.ipify.org?format=json');
      const data = await resp.json();
      ipAddress = data.ip;
    } catch (err) {
      console.warn('Could not fetch IP address for logging', err);
    }

    const logRef = collection(db, 'logs');
    await addDoc(logRef, {
      actionType,
      timestamp: new Date().toISOString(),
      documentId,
      payload,
      ipAddress,
    });
  } catch (error) {
    console.error('Failed to write log:', error);
  }
};
