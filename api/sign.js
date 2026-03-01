import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, getBytes, uploadBytes } from 'firebase/storage';

// Import pdfjs-dist for text extraction
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  storageBucket: "signflow-app-69de2.firebasestorage.app",
  projectId: "signflow-app-69de2",
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
    const sigWidth = 120; // Scaled down width
    const sigHeight = 40;  // Scaled down height
    const boxPadding = 4;
    const textHeight = 8;
    const sigY = targetY + 10; // Y position for the signature image

    // Embed a standard font for the label
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Draw the "Signature" label
    lastPage.drawText('Signature', {
      x: targetX,
      y: sigY + sigHeight + textHeight, // Position text above the box
      font,
      size: 9,
      color: rgb(0.3, 0.3, 0.3),
    });

    // Draw the signature image
    lastPage.drawImage(signatureImage, {
      x: targetX,
      y: sigY, 
      width: sigWidth,
      height: sigHeight,
    });

    // Draw a line below the signature for a clean look
    lastPage.drawLine({
        start: { x: targetX, y: sigY - boxPadding },
        end: { x: targetX + sigWidth, y: sigY - boxPadding },
        thickness: 0.5,
        color: rgb(0.2, 0.2, 0.2),
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