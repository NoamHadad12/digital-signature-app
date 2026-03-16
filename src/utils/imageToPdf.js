import { jsPDF } from 'jspdf';

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const TARGET_DPI = 220;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Failed to decode the selected image file.'));
  image.src = src;
});

const buildPdfFileName = (originalName) => {
  const baseName = String(originalName || 'document').replace(/\.[^/.]+$/, '');
  return `${baseName}.pdf`;
};

export const convertImageToPdf = async (imageFile) => {
  if (!imageFile) {
    throw new Error('No image file was provided for conversion.');
  }

  if (!SUPPORTED_IMAGE_TYPES.has(imageFile.type)) {
    throw new Error('Unsupported image type. Only JPG and PNG are allowed.');
  }

  if (imageFile.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('Image file is too large. Maximum allowed size is 10MB.');
  }

  const imageDataUrl = await readFileAsDataUrl(imageFile);
  const image = await loadImage(imageDataUrl);

  const orientation = image.width >= image.height ? 'landscape' : 'portrait';
  const pageWidthPt = orientation === 'portrait' ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const pageHeightPt = orientation === 'portrait' ? A4_HEIGHT_PT : A4_WIDTH_PT;

  // Render to a high-resolution offscreen canvas before embedding into the PDF.
  const canvasWidthPx = Math.round((pageWidthPt / 72) * TARGET_DPI);
  const canvasHeightPx = Math.round((pageHeightPt / 72) * TARGET_DPI);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Unable to create a canvas context for conversion.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidthPx, canvasHeightPx);

  const scale = Math.min(canvasWidthPx / image.width, canvasHeightPx / image.height);
  const drawWidth = Math.round(image.width * scale);
  const drawHeight = Math.round(image.height * scale);
  const drawX = Math.round((canvasWidthPx - drawWidth) / 2);
  const drawY = Math.round((canvasHeightPx - drawHeight) / 2);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const pdfDocument = new jsPDF({
    orientation,
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  pdfDocument.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    pageWidthPt,
    pageHeightPt,
  );

  const pdfBlob = pdfDocument.output('blob');
  return new File([pdfBlob], buildPdfFileName(imageFile.name), {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
};
