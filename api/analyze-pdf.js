// api/analyze-pdf.js
// Vercel serverless function for Gemini-powered field detection.
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

export const maxDuration = 60;

const MODEL_NAME = 'gemini-2.5-flash';

// 1. Define the exact JSON structure we demand from the AI
const responseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      type: { type: SchemaType.STRING, enum: ["signature", "date", "text"] },
      label: { type: SchemaType.STRING },
      x: { type: SchemaType.NUMBER },
      y: { type: SchemaType.NUMBER }
    },
    required: ["type", "label", "x", "y"]
  }
};

// 2. System Instruction isolated from the user prompt
const SYSTEM_INSTRUCTION = `You are an expert document parser. Find the EXACT center coordinates of signature lines and date fields.
Coordinate system: 0 to 1000. [0,0] is Top-Left, [1000,1000] is Bottom-Right. DO NOT guess round numbers like 500,500. Analyze the visual lines carefully. Return the precise [x, y] of where a human would sign. Look specifically for horizontal lines or empty spaces next to labels like 'Signature', 'Date', or 'Name'.
IMPORTANT: You will receive PDF text metadata. Hebrew words might be physically reversed (Visual Hebrew) due to PDF extraction.
Always reverse Hebrew strings logically before identifying them. For example, 'ךיראת' means 'תאריך' (Date), 'םש' means 'שם' (Name), and 'התימת' means 'חתימה' (Signature).
Assign the correct field type based on the logical word. Return the logical, readable Hebrew in the label.`;

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

async function callGemini({ imageBase64, mimeType, pageNumber, pageText }) {
  const apiKey = (process.env.VITE_GEMINI_API_KEY || '').trim();

  if (!apiKey || apiKey.startsWith('${')) {
    throw new Error('VITE_GEMINI_API_KEY is not configured.');
  }

  const cleanBase64 = String(imageBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (cleanBase64.length < 100) {
    throw new Error('imageBase64 is empty or too short.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 3. Initialize model with Schema and System Instructions
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      temperature: 0,
      // 4096 tokens prevents truncated JSON on long documents with many fields.
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: responseSchema, // Magic happens here! No more regex parsing needed.
    },
  }, { apiVersion: 'v1beta' });

  try {
    const promptParts = [
      { text: `Analyze Page ${pageNumber}.` }
    ];

    if (pageText && typeof pageText === 'string') {
      promptParts.push({ text: `Extracted PDF text metadata: ${pageText}` });
    }

    promptParts.push({
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: cleanBase64,
      },
    });

    const result = await model.generateContent(promptParts);
    const rawText = result.response.text();
    console.log('[AI Raw JSON]', rawText);
    
    // Because we used responseSchema, we can safely JSON.parse without weird regex cleanups
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      console.error('[analyze-pdf] JSON.parse failed on structured output. Parse error:', error.message);
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn('[analyze-pdf] Gemini response was not an array:', parsed);
      return [];
    }

    return parsed.map(normalizeSuggestion).filter(Boolean);
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

  const { imageBase64, mimeType, pageNumber, pageText } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 string is required in the request body.' });
  }

  try {
    const suggestions = await callGemini({ 
      imageBase64, 
      mimeType, 
      pageNumber: Number(pageNumber) || 1, 
      pageText 
    });
    return res.status(200).json({ suggestions });
  } catch (error) {
    console.error('[analyze-pdf] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
