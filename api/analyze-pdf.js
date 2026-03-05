// api/analyze-pdf.js
// Vercel serverless function — AI-powered field detection for uploaded PDFs.
//
// Uses the official @google/generative-ai SDK instead of raw fetch to avoid
// 404 / model-not-found errors caused by manual URL construction.
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
// Sends the raw PDF (as base64) to Gemini 2.5 Flash via the official SDK.
// ---------------------------------------------------------------------------
async function callGemini(base64Pdf) {
  // Force trim to eliminate hidden newlines or spaces Vercel can inject into env vars.
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Guard: fail immediately if the key is missing or looks like an unexpanded
  // template literal such as "${GEMINI_API_KEY}" — a common misconfiguration.
  if (!apiKey || apiKey.startsWith('${')) {
    throw new Error('GEMINI_API_KEY is not set or was not expanded by the environment.');
  }

  // Strip any data-URI prefix the frontend may have included, e.g.:
  // "data:application/pdf;base64,JVBERi0x..."
  // The Gemini SDK expects the raw base64 string only.
  const cleanBase64 = base64Pdf.replace(/^data:[^;]+;base64,/, '').trim();

  // Validate that the cleaned string looks like real base64 content.
  if (!cleanBase64 || cleanBase64.length < 100) {
    throw new Error('base64Pdf appears to be empty or too short after stripping the data-URI prefix.');
  }

  // Strict Initialization: Force API Version v1 via getGenerativeModel
  // Passing apiVersion as the second argument ensures it does not fallback to v1beta,
  // which is a common cause for 404 Not Found errors.
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
  
  const model = genAI.getGenerativeModel(
    {
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature:     0.05,
        maxOutputTokens: 2048,
      },
    },
    { apiVersion: "v1" }
  );

  // ---------------------------------------------------------------------------
  // Prompt engineering
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

  console.log("[STRICT DEBUG] Calling Gemini v1 with model: gemini-2.5-flash");

  // Send the prompt text + PDF inline data. 
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
    console.warn('[analyze-pdf] Gemini returned non-JSON content; falling back to []. Raw output:', rawText);
    return [];
  }

  if (!Array.isArray(suggestions)) {
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
    const suggestions = await callGemini(base64Pdf);
    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);
    
    // Detect quota / rate-limit errors from the Gemini SDK and forward 429
    const isQuotaError =
      error.message?.includes('429') ||
      /quota/i.test(error.message || '');
      
    const statusCode = isQuotaError ? 429 : 500;
    return res.status(statusCode).json({ error: error.message });
  }
}
