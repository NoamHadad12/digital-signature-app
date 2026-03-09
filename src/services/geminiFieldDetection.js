import { pdfjs } from 'react-pdf';

const ANALYZE_ENDPOINT = '/api/analyze-pdf';
const OUTPUT_MIME_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.95;
const MAX_RENDER_WIDTH = 2200;
const BASE_RENDER_SCALE = 2.4; // Ensuring clarity for thin signature lines

// verticalAnchor is 0.5 so that the Gemini-detected center point maps to
// the true visual center of the rendered field box on both axes.
const FIELD_LAYOUT = {
  signature: { width: 0.3, height: 0.06, verticalAnchor: 0.5 },
  date: { width: 0.18, height: 0.045, verticalAnchor: 0.5 },
  customText: { width: 0.24, height: 0.05, verticalAnchor: 0.5 },
};

if (!pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePercentToUnit = (value) => {
  let numeric = null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    numeric = value;
  }
  if (numeric == null) {
    if (typeof value !== 'string') {
      return null;
    }

    numeric = Number.parseFloat(value.replace('%', '').trim());
    if (!Number.isFinite(numeric)) {
      return null;
    }
  }

  return clamp(numeric, 0, 100) / 100;
};

const normalizeFieldType = (rawType, label) => {
  const value = String(rawType || '').trim().toLowerCase();
  if (value === 'signature') return 'signature';
  if (value === 'date') return 'date';
  if (value === 'text' || value === 'customtext' || value === 'custom-text') return 'customText';

  const normalizedLabel = String(label || '').toLowerCase();
  if (normalizedLabel.includes('signature')) return 'signature';
  if (normalizedLabel.includes('date')) return 'date';
  return 'customText';
};

const buildFieldLabel = (type, label, index) => {
  const trimmedLabel = String(label || '').trim();
  if (trimmedLabel) {
    return trimmedLabel;
  }

  if (type === 'signature') return `Signature ${index + 1}`;
  if (type === 'date') return `Date ${index + 1}`;
  return `Text Field ${index + 1}`;
};

const getFieldLayout = (type, label) => {
  if (type !== 'customText') {
    return FIELD_LAYOUT[type];
  }

  const dynamicWidth = clamp(0.18 + (String(label || '').length * 0.006), 0.18, 0.34);
  return {
    ...FIELD_LAYOUT.customText,
    width: dynamicWidth,
  };
};

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Unable to create a canvas context for PDF rendering.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  return { canvas, context };
};

const renderPdfPagesToImages = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true });
  const pdfDocument = await loadingTask.promise;
  const pageImages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      // Scale is clamped to at least 2.0 to ensure thin signature lines stay sharp
      const scale = clamp(MAX_RENDER_WIDTH / baseViewport.width, 2.0, BASE_RENDER_SCALE);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

      await page.render({ canvasContext: context, viewport }).promise;

      pageImages.push({
        pageNumber,
        mimeType: OUTPUT_MIME_TYPE,
        imageBase64: canvas.toDataURL(OUTPUT_MIME_TYPE, OUTPUT_QUALITY).split(',')[1],
      });

      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    if (typeof loadingTask.destroy === 'function') {
      loadingTask.destroy();
    }
  }

  return pageImages;
};

const requestPageSuggestions = async ({ imageBase64, mimeType, pageNumber }) => {
  const response = await fetch(ANALYZE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageBase64, mimeType, pageNumber }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      console.warn(`[geminiFieldDetection] AI analysis returned ${response.status}: ${payload?.error || 'Unknown error'}`);
      return []; // Return empty array to trigger "AI couldn't find fields" toast
    }

    const error = new Error(payload?.error || 'AI analysis failed.');
    error.status = response.status;
    throw error;
  }

  return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
};

const mapGeminiSuggestionToField = (suggestion, pageNumber, index) => {
  const type = normalizeFieldType(suggestion?.type, suggestion?.label);
  const label = buildFieldLabel(type, suggestion?.label, index);
  const centerX = parsePercentToUnit(suggestion?.x);
  const centerY = parsePercentToUnit(suggestion?.y);

  if (centerX == null || centerY == null) {
    return null;
  }

  const layout = getFieldLayout(type, label);
  const nx = clamp(centerX - (layout.width / 2), 0, 1 - layout.width);
  const ny = clamp(centerY - (layout.height * layout.verticalAnchor), 0, 1 - layout.height);

  return {
    id: crypto.randomUUID(),
    type,
    label,
    page: pageNumber,
    nx,
    ny,
    nw: layout.width,
    nh: layout.height,
    confirmed: false,
  };
};

const dedupeFields = (fields) => {
  return fields.filter((field, index) => {
    return fields.findIndex((candidate) => (
      candidate.page === field.page &&
      candidate.type === field.type &&
      Math.abs(candidate.nx - field.nx) < 0.02 &&
      Math.abs(candidate.ny - field.ny) < 0.02
    )) === index;
  });
};

export const detectFieldsWithGemini = async (file) => {
  const pageImages = await renderPdfPagesToImages(file);
  const mappedFields = [];

  for (const pageImage of pageImages) {
    const pageSuggestions = await requestPageSuggestions(pageImage);

    pageSuggestions.forEach((suggestion) => {
      const mappedField = mapGeminiSuggestionToField(suggestion, pageImage.pageNumber, mappedFields.length);
      if (mappedField) {
        mappedFields.push(mappedField);
      }
    });
  }

  return dedupeFields(mappedFields);
};