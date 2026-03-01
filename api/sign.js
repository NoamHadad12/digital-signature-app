import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// fontkit is no longer needed for standard fonts
// import fontkit from '@pdf-lib/fontkit'; 
import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, getBytes, uploadBytes } from 'firebase/storage';

// Import pdfjs-dist for text extraction
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { documentId, signatureData } = req.body;

  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const storage = getStorage(app);
    const fileRef = ref(storage, `pdfs/${documentId}.pdf`);

    // 1. Download original PDF
    const existingPdfBytes = await getBytes(fileRef);

    // 2. Load PDF for modifying (pdf-lib)
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const base64Data = signatureData.split(',')[1];
    const signatureImage = await pdfDoc.embedPng(Buffer.from(base64Data, 'base64'));

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // 3. Search for Keywords using pdfjs-dist
    let targetX = width - 150 - 15; // Default X (bottom right)
    let targetY = 30;               // Default Y (bottom right)
    
const keywords = [
  // English - Direct Instructions
  "sign here", 
  "signature", 
  "signatory", 
  "initials", 
  "signed by",
  "execute here",
  "witness signature",
  "authorized signature",
  "print name",
  
  // Hebrew - Direct Instructions
  "חתום כאן", 
  "חתימה", 
  "חתימת הלקוח", 
  "חתימת השוכר", 
  "חתימת המוכר",
  "חתימת המצהיר",
  "שם וחתימה",
  "חתימת המורשה",
  "חתימה וחותמת",
  "ראשי תיבות",
  "אישור",
];    
    try {
      // Load document into the text scanner
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(existingPdfBytes) });
      const doc = await loadingTask.promise;
      const targetPageNum = pages.length; // Scan the last page
      const page = await doc.getPage(targetPageNum);
      const textContent = await page.getTextContent();

      // Iterate over text items to find keywords
      for (const item of textContent.items) {
        const textStr = item.str.toLowerCase().trim();
        // Check if the current text block contains any of our keywords
        if (keywords.some(keyword => textStr.includes(keyword))) {
          // item.transform[4] is X, item.transform[5] is Y
          targetX = item.transform[4];
          targetY = item.transform[5];
          console.log(`Found keyword "${textStr}" at X: ${targetX}, Y: ${targetY}`);
          break; // Stop searching once found
        }
      }
    } catch (scanError) {
      console.warn("Text scanning failed or skipped, using default placement:", scanError.message);
    }

    // 4. Define signature area dimensions and draw elements
    const sigWidth = 150; // Slightly wider for better presence
    const sigHeight = 50;
    const boxPadding = 5;
    const sigY = targetY + 15; // Adjust vertical placement

    // --- REVERT TO STANDARD FONT FOR ENGLISH ---
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Draw the "Signature" label with a clean, bold look
    lastPage.drawText('Signature', {
      x: targetX,
      y: sigY + sigHeight + boxPadding, // Position text above the signature area
      font: font, // Use the standard Helvetica-Bold font
      size: 12,
      color: rgb(0.1, 0.1, 0.1),
    });

    // Draw the signature image, making it appear bolder
    lastPage.drawImage(signatureImage, {
      x: targetX,
      y: sigY,
      width: sigWidth,
      height: sigHeight,
      opacity: 0.95, // Increase opacity to make the signature bolder
    });

    // Draw a thicker line below the signature for a professional finish
    lastPage.drawLine({
        start: { x: targetX, y: sigY - boxPadding + 2 },
        end: { x: targetX + sigWidth, y: sigY - boxPadding + 2 },
        thickness: 1.5, // Thicker line
        color: rgb(0.1, 0.1, 0.1),
    });

    // 5. Save and Upload
    const pdfBytes = await pdfDoc.save();
    const signedFileRef = ref(storage, `pdfs/signed_${documentId}.pdf`);
    
    const metadata = { contentType: 'application/pdf' };
    await uploadBytes(signedFileRef, pdfBytes, metadata);

    res.status(200).json({ 
      message: 'Success', 
      fileName: `signed_${documentId}.pdf`,
      downloadUrl: `pdfs/signed_${documentId}.pdf` 
    });

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: error.message });
  }
}