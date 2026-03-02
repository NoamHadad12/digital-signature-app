import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { initializeApp, getApps } from 'firebase/app';
import { getStorage, ref, getBytes, uploadBytes, getDownloadURL } from 'firebase/storage';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve the directory of this module so we can locate the bundled font file
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load the Heebo font (Hebrew-supporting) with a local-first, CDN-fallback strategy.
// The local copy is bundled alongside the function; CDNs are used as a safety net.
async function loadHeeboFont() {
  // Prefer the locally-bundled copy — zero latency, no external dependency
  try {
    return readFileSync(join(__dirname, 'fonts', 'Heebo-Regular.ttf'));
  } catch (_) {
    // File not found in the bundle; fall through to network sources
  }

  const CDN_URLS = [
    'https://raw.githubusercontent.com/google/fonts/main/ofl/heebo/Heebo%5Bwght%5D.ttf',
    'https://fonts.gstatic.com/s/heebo/v26/NGSpv5_NC0k9P_v6ZUCbLRAHxK1EiSysdUmr.ttf',
  ];

  for (const url of CDN_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch (_) {
      // This CDN failed — try the next one
    }
  }

  throw new Error('All Hebrew font sources failed. Cannot embed a Hebrew-capable font in the PDF.');
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Detect whether a string contains Hebrew Unicode characters (U+0590–U+05FF)
const containsHebrew = (str) => /[\u0590-\u05FF]/.test(str);

// For RTL text, reverse character order so pdf-lib (which is LTR-only) renders it correctly
const toRTLString = (str) => str.split('').reverse().join('');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // Accept the markers array, per-field form values, and the optional signature image
  const { documentId, signatureData, markers, signatureCoords, formValues } = req.body;

  // Normalize to an array so the rest of the handler always works with one format
  let resolvedMarkers = [];
  if (Array.isArray(markers) && markers.length > 0) {
    resolvedMarkers = markers;
  } else if (signatureCoords) {
    resolvedMarkers = [signatureCoords];
  }

  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const storage = getStorage(app);
    const fileRef = ref(storage, `pdfs/${documentId}.pdf`);

    // Download the original PDF bytes from Firebase Storage
    const existingPdfBytes = await getBytes(fileRef);

    // Load the PDF and register fontkit so custom fonts (including Hebrew) can be embedded
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    pdfDoc.registerFontkit(fontkit);

    // Load the Heebo font bytes using the local-first strategy defined above
    const fontBytes = await loadHeeboFont();
    const hebrewFont = await pdfDoc.embedFont(fontBytes);

    // Embed the signature image only when the signer provided one
    let signatureImage = null;
    if (signatureData) {
      const base64Data = signatureData.split(',')[1];
      signatureImage = await pdfDoc.embedPng(Buffer.from(base64Data, 'base64'));
    }

    const pages = pdfDoc.getPages();

    // Draw each field at its marker location
    for (const [markerIndex, marker] of resolvedMarkers.entries()) {
      // Convert 1-based page number to 0-based index; default to the last page
      const targetPageIndex = marker.page != null ? marker.page - 1 : pages.length - 1;
      const targetPage = pages[targetPageIndex];

      if (!targetPage) continue; // Skip if the stored page number is out of range

      const { width, height } = targetPage.getSize();

      // Scale the bounding box from normalized units to PDF point units
      const sigWidth  = (marker.nw ?? 0.3)  * width;
      const sigHeight = (marker.nh ?? 0.08) * height;

      // Map normalized top-left (nx, ny) to pdf-lib coordinates.
      // pdf-lib uses a bottom-to-top Y axis, so we invert and subtract the box height.
      const targetX = (marker.nx ?? 0) * width;
      const targetY = (1 - (marker.ny ?? 0) - (marker.nh ?? 0.08)) * height;

      const isSignature = !marker.type || marker.type === 'signature';

      if (isSignature) {
        // Draw the signature PNG floating without any background or underline
        if (signatureImage) {
          targetPage.drawImage(signatureImage, {
            x: targetX,
            y: targetY,
            width: sigWidth,
            height: sigHeight,
            opacity: 0.95,
          });
        }
      } else if (marker.type === 'text') {
        // Retrieve the value the signer entered for this field
        const rawValue =
          formValues && formValues[markerIndex] != null ? String(formValues[markerIndex]) : '';

        if (rawValue) {
          // Scale font size proportionally to the box height; clamp between 8 pt and 20 pt
          const fontSize = Math.max(8, Math.min(sigHeight * 0.55, 20));
          // Vertically center the text baseline within the bounding box
          const textY = targetY + (sigHeight - fontSize) / 2;

          const isRTL = containsHebrew(rawValue);

          // For RTL (Hebrew) text: reverse the glyph order and right-align inside the box.
          // pdf-lib has no native BiDi engine, so manual reversal is required for correct display.
          const textToRender = isRTL ? toRTLString(rawValue) : rawValue;

          // Calculate rendered text width so we can right-align Hebrew text precisely
          const textWidth = hebrewFont.widthOfTextAtSize(textToRender, fontSize);
          const textX = isRTL
            ? targetX + sigWidth - textWidth - 4   // right-aligned for RTL
            : targetX + 4;                          // left-aligned for LTR

          targetPage.drawText(textToRender, {
            x: textX,
            y: textY,
            size: fontSize,
            font: hebrewFont,
            color: rgb(0.05, 0.05, 0.05),
            maxWidth: sigWidth - 8,
          });
        }
      }
    }

    // Serialize the modified PDF and upload it to Firebase Storage
    const pdfBytes = await pdfDoc.save();
    const signedFileRef = ref(storage, `pdfs/signed_${documentId}.pdf`);

    const metadata = { contentType: 'application/pdf' };
    await uploadBytes(signedFileRef, pdfBytes, metadata);

    // Generate a public download URL with a token
    const downloadUrl = await getDownloadURL(signedFileRef);

    res.status(200).json({
      message: 'Success',
      fileName: `signed_${documentId}.pdf`,
      downloadUrl: downloadUrl
    });

  } catch (error) {
    console.error('Backend Error:', error);
    res.status(500).json({ error: error.message });
  }
}