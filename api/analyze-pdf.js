// api/analyze-pdf.js
// Vercel serverless function for Gemini-powered field detection.
import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export const maxDuration = 60;

const MODEL_NAME = 'gemini-1.5-flash';

const ANALYSIS_PROMPT = [
  "Analyze this document image and identify all 'Signature', 'Date', and 'Text' fields.",
  "Return a valid JSON array of objects: { type: 'signature' | 'date', label: string, x: percentage, y: percentage }.",
  "For generic text-entry fields, use type 'text' and keep the same object shape.",
  "Look specifically for lines labeled 'Client Signature', 'Provider Signature', or empty date lines.",
  'Only include fields that a person is expected to fill in.',
  'Set x and y to the center point of the blank line or fillable area as percentages from 0 to 100.',
  'Return [] if this page does not contain any fillable signature, date, or text fields.',
  'Return JSON only with no markdown and no extra explanation.',
].join(' ');

const parsePercent = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 1 ? value * 100 : value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const numeric = Number.parseFloat(value.replace('%', '').trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
};

const normalizeSuggestion = (entry) => {
  const rawType = String(entry?.type || '').trim().toLowerCase();
  const type = rawType === 'text' ? 'text' : rawType === 'date' ? 'date' : rawType === 'signature' ? 'signature' : null;
  const x = parsePercent(entry?.x);
  const y = parsePercent(entry?.y);

  if (!type || x == null || y == null) {
    return null;
  }

  const label = String(entry?.label || '').trim() || (type === 'text' ? 'Text Field' : type === 'date' ? 'Date' : 'Signature');

  return {
    type,
    label,
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
  };
};

const parseGeminiJson = (rawText) => {
  const jsonText = String(rawText || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  if (!jsonText) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.warn('[analyze-pdf] Gemini returned non-JSON content:', rawText);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('[analyze-pdf] Gemini response was not an array:', parsed);
    return [];
  }

  return parsed.map(normalizeSuggestion).filter(Boolean);
};

async function callGemini({ imageBase64, mimeType, pageNumber }) {
  const apiKey = (process.env.VITE_GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey.startsWith('${')) {
    throw new Error('VITE_GEMINI_API_KEY is not configured.');
  }

  const cleanBase64 = String(imageBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (cleanBase64.length < 100) {
    throw new Error('imageBase64 is empty or too short.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel(
    {
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    },
    { apiVersion: 'v1beta' }
  );

  const result = await model.generateContent([
    { text: `Page ${pageNumber}. ${ANALYSIS_PROMPT}` },
    {
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: cleanBase64,
      },
    },
  ]);

  return parseGeminiJson(result.response.text());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, mimeType, pageNumber } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: '`imageBase64` string is required in the request body.' });
  }

  try {
    const suggestions = await callGemini({ imageBase64, mimeType, pageNumber: Number(pageNumber) || 1 });
    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);

    const isQuotaError =
      error.message?.includes('429') ||
      /quota/i.test(error.message || '');

    const statusCode = isQuotaError ? 429 : 500;
    return res.status(statusCode).json({ error: error.message });
  }
}
