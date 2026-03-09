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

const MODEL_NAME = 'gemini-2.5-flash';

const ANALYSIS_PROMPT = "You are a document parser. Return ONLY a JSON array of objects: { 'type': 'signature' | 'date', 'label': string, 'x': number, 'y': number }. Identify lines near 'Signature' and 'Date' labels. Set x and y to the center point of the fillable area. Gemini 2.5 Flash returns spatial coordinates in a 0-1000 scale.";

const parsePercent = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Gemini 2.5 Flash returns 0-1000 scale. Convert to 0-100 percentages.
    return value / 10;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const numeric = Number.parseFloat(value.replace('%', '').trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }

  // Handle cases where string contains 0-1000 scale
  return numeric / 10;
};

const normalizeSuggestion = (entry) => {
  const rawType = String(entry?.type || '').trim().toLowerCase();
  // Relaxed filtering: default to 'text' if not strictly 'date' or 'signature'
  const type = rawType.includes('date') ? 'date' : rawType.includes('signature') ? 'signature' : 'text';
  const x = parsePercent(entry?.x);
  const y = parsePercent(entry?.y);

  if (x == null || y == null) {
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
  // Robust cleaner for AI output
  const cleanText = String(rawText || '')
    .replace(/```json|```/g, "")
    .trim();

  console.log("[AI Debug] Raw Gemini Output:", cleanText);

  if (!cleanText || cleanText === '[]' || cleanText === 'null') {
    console.warn('[analyze-pdf] Gemini returned an empty array or no detections. Raw text:', rawText);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch (error) {
    console.error('[analyze-pdf] Failed to parse Gemini output:', cleanText, error);
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
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  }, { apiVersion: 'v1beta' });

  try {
    const result = await model.generateContent([
      { text: "Page " + pageNumber + ". " + ANALYSIS_PROMPT },
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: cleanBase64,
        },
      },
    ]);

    const rawText = result.response.text();
    console.log('[AI Raw Response]', rawText);
    return parseGeminiJson(rawText);
  } catch (error) {
    console.warn("[analyze-pdf] Gemini API error: " + error.message);
    if (error.status === 404 || error.message.includes('404') || error.message.includes('not found') || error.message.includes('ModelNotSupported')) {
      return [];
    }
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, mimeType, pageNumber } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 string is required in the request body.' });
  }

  try {
    const suggestions = await callGemini({ imageBase64, mimeType, pageNumber: Number(pageNumber) || 1 });
    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
