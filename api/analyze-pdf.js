// api/analyze-pdf.js
// Vercel serverless function — AI-powered field detection for uploaded PDFs.
//
// Flow:
//   1. Receive a base64-encoded PDF from the frontend (no prior Firebase Storage upload needed).
//   2. Render page 1 to a JPEG using pdfjs-dist + canvas (both are native Node.js capable).
//   3. Send the JPEG to Google Gemini Vision and parse the structured field suggestions.
//   4. Return the raw suggestions array — Firestore is NOT touched here.
//      Writing markers to Firestore only happens after the admin approves suggestions
//      and clicks "Upload & Generate Link" (Human-in-the-Loop design).

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdfjs in Node.js does not use a web worker — disable the worker entirely.
GlobalWorkerOptions.workerSrc = '';

// ---------------------------------------------------------------------------
// Increase Vercel's default 4.5 MB JSON body limit so large PDFs can be sent.
// ---------------------------------------------------------------------------
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// ---------------------------------------------------------------------------
// renderFirstPageToBase64
// Converts the first page of a PDF buffer to a base64-encoded JPEG string.
// Resolution is kept at 2× (≈150 DPI) — enough for Vision models while
// staying well within Gemini's 4 MB inline image limit.
// ---------------------------------------------------------------------------
async function renderFirstPageToBase64(pdfBuffer) {
  // pdfjs-dist requires a Uint8Array, not a Node Buffer
  const uint8 = new Uint8Array(pdfBuffer);

  const loadingTask = getDocument({ data: uint8, disableFontFace: true });
  const pdfDoc      = await loadingTask.promise;
  const page        = await pdfDoc.getPage(1);  // Only the first page is needed for field detection

  const SCALE    = 2;  // 2× base = ~150 DPI
  const viewport = page.getViewport({ scale: SCALE });

  // Dynamically import 'canvas' so the bundler can tree-shake it from browser builds
  const { createCanvas } = await import('canvas');
  const canvas  = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  // Render the PDF page directly into the node canvas context
  await page.render({ canvasContext: context, viewport }).promise;

  // Encode the rendered image as JPEG (quality 88% balances size vs. clarity)
  return canvas.toBuffer('image/jpeg', { quality: 0.88 }).toString('base64');
}

// ---------------------------------------------------------------------------
// callGeminiVision
// Sends the base64 JPEG to Gemini 1.5 Flash and returns the parsed suggestions
// array.  Temperature is set very low so the model outputs deterministic JSON.
// ---------------------------------------------------------------------------
async function callGeminiVision(base64Image) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set on the server.');
  }

  const MODEL   = 'gemini-1.5-flash-latest';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------------------------------------------------------------------------
  // Prompt engineering:
  //   - Coordinates are normalised 0–1 (NOT 0–100) so they map directly onto
  //     our nx / ny / nw / nh schema without any division on the client.
  //   - "confidence" (0–1) lets the frontend colour ghost markers by certainty.
  //   - Only three semantic types are allowed: signature, date, customText.
  // ---------------------------------------------------------------------------
  const SYSTEM_PROMPT = `You are a document-analysis AI. Examine the provided image of a document page and locate every form field that requires user input.

Identify fields of ONLY these types:
1. "signature"   — a designated area for a handwritten signature.
2. "date"        — a field for entering a date.
3. "customText"  — a field for typed text (Full Name, ID Number, Company Name, Address, etc.).
   For "customText" items, read the printed label near the field and use it as the "label" value.

CRITICAL output rules:
- Return ONLY a valid JSON array — no markdown fences, no explanations.
- Coordinates MUST be normalised between 0 and 1 (fraction of page width/height).
  • "nx", "ny" = top-left corner of the bounding box.
  • "nw", "nh" = width and height of the bounding box.
- Every object MUST have: type, nx, ny, nw, nh, confidence (0–1), page (always 1).
- "customText" objects MUST also include a "label" string.
- If no fields are detected, return: []

Example valid output:
[
  { "type": "signature",  "label": "Signature",  "page": 1, "nx": 0.05, "ny": 0.82, "nw": 0.35, "nh": 0.06, "confidence": 0.95 },
  { "type": "date",       "label": "Date",       "page": 1, "nx": 0.60, "ny": 0.82, "nw": 0.25, "nh": 0.06, "confidence": 0.90 },
  { "type": "customText", "label": "Full Name",  "page": 1, "nx": 0.05, "ny": 0.55, "nw": 0.40, "nh": 0.05, "confidence": 0.88 }
]`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: SYSTEM_PROMPT },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature:     0.05,  // Near-zero temperature for deterministic structured output
      maxOutputTokens: 2048,
    },
  };

  const response = await fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(requestBody),
    signal:  AbortSignal.timeout(45_000),  // 45 s hard timeout for slow Vision responses
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API responded with status ${response.status}: ${errText}`);
  }

  const data    = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Strip accidental markdown code fences before parsing
  const jsonString = rawText
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  let suggestions;
  try {
    suggestions = JSON.parse(jsonString);
  } catch {
    throw new Error(`Gemini returned non-JSON content: "${rawText}"`);
  }

  if (!Array.isArray(suggestions)) {
    throw new Error('Gemini response is not a JSON array.');
  }

  // Clamp all coordinates to [0, 1] and guarantee required fields are present
  return suggestions.map((s, i) => ({
    type:       s.type || 'customText',
    label:      s.label || s.type || 'Field',
    page:       s.page  ?? 1,
    nx:         Math.max(0, Math.min(1, Number(s.nx)  || 0)),
    ny:         Math.max(0, Math.min(1, Number(s.ny)  || 0)),
    nw:         Math.max(0, Math.min(1, Number(s.nw)  || 0.2)),
    nh:         Math.max(0, Math.min(1, Number(s.nh)  || 0.05)),
    confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
  }));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { base64Pdf } = req.body;

  if (!base64Pdf || typeof base64Pdf !== 'string') {
    return res.status(400).json({ error: '`base64Pdf` string is required in the request body.' });
  }

  try {
    // Decode the incoming base64 PDF string into a Node.js Buffer
    const pdfBuffer = Buffer.from(base64Pdf, 'base64');

    // Render the first PDF page to a base64 JPEG for the Vision model
    const base64Image  = await renderFirstPageToBase64(pdfBuffer);

    // Ask Gemini to locate form fields and return structured coordinates
    const suggestions  = await callGeminiVision(base64Image);

    return res.status(200).json({ suggestions });

  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
