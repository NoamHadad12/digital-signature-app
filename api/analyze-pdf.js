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

const ANALYSIS_PROMPT = "Find any line that looks like it needs a signature or a date. Return ONLY a raw JSON array of objects: { 'type': 'signature' | 'date', 'x': number, 'y': number }. No markdown, no backticks, no conversational text. Set x and y to the center point of the fillable area as percentages from 0 to 100. If you return values from 0 to 1000, ensure they are divided by 10 so they represent a percentage (0 to 100).";

const parsePercent = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Coordinate mapping check in case AI returns numbers in 0-1000 bounds instead of 0-100
    let mappedValue = value;
    if (mappedValue > 100 && mappedValue <= 1000) {
      mappedValue = mappedValue / 10;
    }
    return mappedValue > 0 && mappedValue < 1 ? mappedValue * 100 : mappedValue;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const numeric = Number.parseFloat(value.replace('%', '').trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }

  // Handle case where Gemini returns coordinate in the 0-1000 range instead of 0-100
  let mappedValue = numeric;
  if (mappedValue > 100 && mappedValue <= 1000) {
    mappedValue = mappedValue / 10;
  }

  return mappedValue > 0 && mappedValue < 1 ? mappedValue * 100 : mappedValue;
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
  // Aggressive markdown sanitization as fallback
  const cleanText = String(rawText || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  console.log("[AI Debug] Raw Gemini Output:", cleanText);

  if (!cleanText || cleanText === '[]' || cleanText === 'null') {
    console.warn('[analyze-pdf] Gemini returned an empty array or no detections.');
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
  // Using gemini-1.5-flash without v1beta, as the SDK handles versions natively
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  });

  try {
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
  } catch (error) {
    console.warn(`[analyze-pdf] Gemini API error: ${error.message}`);
    // If ModelNotSupported or 404 is thrown, return empty array to trigger client fallback
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('ModelNotSupported')) {
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
