// api/analyze-pdf.js
// Vercel serverless function — AI-powered field detection for uploaded PDFs.
//
// Flow:
//   1. Receive a base64-encoded PDF from the frontend.
//   2. Pass the PDF bytes directly to Gemini as `application/pdf` inline_data.
//      Gemini 1.5 natively understands PDF structure — NO canvas, NO image
//      conversion, NO native binaries required.  Works on Windows out of the box.
//   3. Parse the structured field suggestions from Gemini's JSON response.
//   4. Return the suggestions array — Firestore is NOT touched here.
//      Writing confirmed markers to Firestore only occurs after the admin clicks
//      "Upload & Generate Link" (Human-in-the-Loop design).

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
// callGemini
// Sends the raw PDF (as base64) to Gemini 1.5 Flash using the native PDF
// inline_data support.  Returns the parsed suggestions array.
//
// Why PDF directly instead of converting to an image first?
//   • Gemini 1.5 accepts application/pdf as an inline_data mime_type, so it can
//     read text layers, vector graphics, and metadata — far more accurate than
//     a rasterised screenshot at moderate DPI.
//   • This approach has ZERO native dependencies (no canvas, no pdfjs rendering),
//     so it works on any OS including Windows with Node v24+.
//
// Temperature is set very low so the model outputs deterministic JSON.
// ---------------------------------------------------------------------------
async function callGemini(base64Pdf) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set on the server.');
  }

  const MODEL   = 'gemini-1.5-flash';
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ---------------------------------------------------------------------------
  // Prompt engineering:
  //   - Coordinates are normalised 0–1 (fraction of page width/height) so they
  //     map directly onto our nx / ny / nw / nh schema without client-side math.
  //   - "confidence" (0–1) lets the frontend colour ghost markers by certainty.
  //   - Only three semantic types are allowed: signature, date, customText.
  //   - "page" is 1-indexed and must match the actual PDF page number.
  // ---------------------------------------------------------------------------
  const SYSTEM_PROMPT = `You are a document-analysis AI. Examine the provided PDF and locate every form field that requires user input across all pages.

Identify fields of ONLY these types:
1. "signature"   — a designated area for a handwritten signature.
2. "date"        — a field for entering a date.
3. "customText"  — a field for typed text (Full Name, ID Number, Company Name, Address, etc.).
   For "customText" items, read the printed label near the field and use it as the "label" value.

CRITICAL output rules:
- Return ONLY a valid JSON array — no markdown fences, no explanations, no prose.
- Coordinates MUST be normalised between 0 and 1 (fraction of page width/height).
  • "nx", "ny" = top-left corner of the bounding box.
  • "nw", "nh" = width and height of the bounding box.
- Every object MUST have: type, nx, ny, nw, nh, confidence (0–1), page (1-indexed).
- "customText" objects MUST also include a "label" string.
- If no fields are detected on any page, return: []

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
              // Gemini 1.5 natively supports PDF — no image conversion step required
              mime_type: 'application/pdf',
              data:      base64Pdf,
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
    signal:  AbortSignal.timeout(45_000),  // 45 s hard timeout for slow model responses
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
    // Gemini occasionally returns a plain explanation instead of JSON (e.g. when
    // it cannot locate any fields, or when the document is scanned at low quality).
    // Falling back to an empty array is safer than crashing — the admin can still
    // place fields manually.
    console.warn('[analyze-pdf] Gemini returned non-JSON content; falling back to []. Raw output:', rawText);
    return [];
  }

  if (!Array.isArray(suggestions)) {
    // The model returned valid JSON but not an array — treat it as empty
    console.warn('[analyze-pdf] Gemini response is not a JSON array; falling back to []. Got:', suggestions);
    return [];
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
    // Send the PDF directly to Gemini — no image conversion step required
    const suggestions = await callGemini(base64Pdf);
    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
