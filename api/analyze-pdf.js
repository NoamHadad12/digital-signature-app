// api/analyze-pdf.js
// Vercel serverless function — AI-powered field detection for uploaded PDFs.
//
// Uses the official @google/generative-ai SDK instead of raw fetch to avoid
// 404 / model-not-found errors caused by manual URL construction.
//
// Flow:
//   1. Receive a base64-encoded PDF from the frontend.
//   2. Pass the PDF bytes directly to Gemini as inlineData (application/pdf).
//      Gemini 1.5 natively understands PDF structure — NO canvas, NO image
//      conversion, NO native binaries required.  Works on Windows out of the box.
//   3. Parse the structured field suggestions from Gemini's JSON response.
//   4. Return the suggestions array — Firestore is NOT touched here.
//      Writing confirmed markers to Firestore only occurs after the admin clicks
//      "Upload & Generate Link" (Human-in-the-Loop design).
import { GoogleGenerativeAI } from '@google/generative-ai';

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
// Sends the raw PDF (as base64) to Gemini 1.5 Flash via the official SDK.
// Using the SDK instead of raw fetch avoids 404 errors caused by incorrect
// manual URL or version construction.
//
// Why PDF directly instead of converting to an image first?
//   • Gemini 1.5 accepts application/pdf as inlineData mimeType, so it can
//     read text layers, vector graphics, and metadata — far more accurate than
//     a rasterised screenshot at moderate DPI.
//   • This approach has ZERO native dependencies (no canvas, no pdfjs rendering),
//     so it works on any OS including Windows with Node v24+.
//
// Temperature is set very low so the model outputs deterministic JSON.
// ---------------------------------------------------------------------------
async function callGemini(base64Pdf) {
  // Force trim to eliminate hidden newlines or spaces Vercel can inject into env vars.
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Guard: fail immediately if the key is missing or looks like an unexpanded
  // template literal such as "${GEMINI_API_KEY}" — a common misconfiguration.
  if (!apiKey || apiKey.startsWith('${')) {
    throw new Error('GEMINI_API_KEY is not set or was not expanded by the environment.');
  }

  // Downgraded from gemini-2.0-flash → gemini-1.5-flash-8b.
  // New free-tier accounts in most regions have a literal quota of 0 for the
  // 2.0 model, while 1.5-flash-8b has a generous free quota that is almost
  // always open — this is the root cause of the "limit: 0" 429 responses.
  const modelName = 'gemini-1.5-flash-8b';
  console.log('[analyze-pdf] Using model:', modelName);
  console.log(`[analyze-pdf] Key prefix: ${apiKey.slice(0, 6)}...`);

  // Strip any data-URI prefix the frontend may have included, e.g.:
  // "data:application/pdf;base64,JVBERi0x..."
  // The Gemini SDK expects the raw base64 string only.
  const cleanBase64 = base64Pdf.replace(/^data:[^;]+;base64,/, '').trim();

  // Validate that the cleaned string looks like real base64 content.
  // An empty or suspiciously short string causes Gemini to return a confusing
  // quota / parse error rather than a clear 400 bad-request response.
  if (!cleanBase64 || cleanBase64.length < 100) {
    throw new Error('base64Pdf appears to be empty or too short after stripping the data-URI prefix.');
  }

  // Explicitly pin the SDK to the v1 stable endpoint.
  // Without this, the SDK defaults to v1beta, which returns 404 for GA models.
  const genAI = new GoogleGenerativeAI(apiKey.trim());
  console.log("[STRICT DEBUG] Forcing API Version v1 via getGenerativeModel");
  const model = genAI.getGenerativeModel(
    {
      model: "gemini-1.5-flash-8b",
      generationConfig: {
        temperature:     0.05,  // Near-zero temperature for deterministic structured output
        maxOutputTokens: 2048,
      },
    },
    { apiVersion: "v1" }
  );

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

  // Send the prompt text + PDF inline data to Gemini via the SDK.
  // cleanBase64 has had any data-URI prefix stripped, so only raw base64 is sent.
  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    {
      inlineData: {
        mimeType: 'application/pdf',
        data:     cleanBase64,
      },
    },
  ]);

  const rawText = result.response.text() ?? '';

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
    // Detect quota / rate-limit errors from the Gemini SDK and forward 429
    // so the frontend can display a user-friendly message instead of a generic 500.
    const isQuotaError =
      error.message?.includes('429') ||
      /quota/i.test(error.message || '');
    const statusCode = isQuotaError ? 429 : 500;
    return res.status(statusCode).json({ error: error.message });
  }
}
