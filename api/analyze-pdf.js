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

const ANALYSIS_PROMPT = "You are an expert document parser. Your goal is to find the EXACT center coordinates of signature lines and date fields. Use a coordinate system from 0 to 1000. [0,0] is Top-Left, [1000,1000] is Bottom-Right. DO NOT guess or return round numbers like 500, 500. Analyze the visual lines carefully. Return the precise [x, y] of where a human would sign. Look specifically for horizontal lines or empty spaces next to labels like 'Signature', 'Date', or 'Name'. Return ONLY a raw JSON array of objects — no markdown, no backticks, no text before or after the array. Each object must have exactly these keys: { \"type\": \"signature\" | \"date\", \"label\": string, \"x\": number, \"y\": number }. The array must be complete and valid JSON with every object properly closed."

// Coordinate scaling: Gemini returns values on a 0-1000 scale.
// We must divide by 10 to convert them to 0-100 percent values used by the UI.
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
  const raw = String(rawText || '');

  // Use a regex to extract the outermost JSON array, handling any surrounding
  // text, markdown fences (```json ... ```), or stray characters Gemini may add.
  const match = raw.match(/\[[\s\S]*\]/);
  const cleanText = match ? match[0].trim() : '';

  console.log('[AI Debug] Cleaned Gemini Output:', cleanText);

  if (!cleanText || cleanText === '[]') {
    console.warn('[analyze-pdf] Gemini returned no detectable JSON array. Full raw response:', raw);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch (error) {
    // Log the first and last 50 chars of the raw response to pinpoint where truncation occurs.
    const head = raw.slice(0, 50);
    const tail = raw.slice(-50);
    console.error('[analyze-pdf] JSON.parse failed. Parse error:', error.message);
    console.error('[analyze-pdf] Raw response head (first 50):', head);
    console.error('[analyze-pdf] Raw response tail (last 50):', tail);
    console.error('[analyze-pdf] Full cleaned/extracted string:', cleanText);
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
      // 4096 tokens prevents truncated JSON on long documents with many fields.
      maxOutputTokens: 4096,
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
