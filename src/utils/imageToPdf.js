import { jsPDF } from 'jspdf';

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const TARGET_DPI = 300;
const JPEG_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg']);
const JPEG_QUALITY = 1.0;

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

  // Keep the effective output DPI high and never upscale low-resolution images.
  const sourceWidthAtTargetDpiPt = (image.width / TARGET_DPI) * 72;
  const sourceHeightAtTargetDpiPt = (image.height / TARGET_DPI) * 72;
  const pageFitScale = Math.min(
    pageWidthPt / sourceWidthAtTargetDpiPt,
    pageHeightPt / sourceHeightAtTargetDpiPt,
    1,
  );

  const drawWidthPt = sourceWidthAtTargetDpiPt * pageFitScale;
  const drawHeightPt = sourceHeightAtTargetDpiPt * pageFitScale;
  const drawXPt = (pageWidthPt - drawWidthPt) / 2;
  const drawYPt = (pageHeightPt - drawHeightPt) / 2;

  // Render at the final high-DPI placement size before embedding into the PDF.
  const canvasWidthPx = Math.max(1, Math.round((drawWidthPt / 72) * TARGET_DPI));
  const canvasHeightPx = Math.max(1, Math.round((drawHeightPt / 72) * TARGET_DPI));
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Unable to create a canvas context for conversion.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidthPx, canvasHeightPx);

  const scale = Math.min(canvasWidthPx / image.width, canvasHeightPx / image.height, 1);
  const drawWidthPx = Math.max(1, Math.round(image.width * scale));
  const drawHeightPx = Math.max(1, Math.round(image.height * scale));
  const drawXPx = Math.round((canvasWidthPx - drawWidthPx) / 2);
  const drawYPx = Math.round((canvasHeightPx - drawHeightPx) / 2);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, drawXPx, drawYPx, drawWidthPx, drawHeightPx);

  const isJpegInput = JPEG_IMAGE_TYPES.has(imageFile.type);
  const embedMimeType = isJpegInput ? 'image/jpeg' : 'image/png';
  const embedFormat = isJpegInput ? 'JPEG' : 'PNG';
  const imageDataForPdf = isJpegInput
    ? canvas.toDataURL(embedMimeType, JPEG_QUALITY)
    : canvas.toDataURL(embedMimeType);

  const pdfDocument = new jsPDF({
    orientation,
    unit: 'pt',
    format: 'a4',
    compress: false,
    precision: 16,
  });

  pdfDocument.addImage(
    imageDataForPdf,
    embedFormat,
    drawXPt,
    drawYPt,
    drawWidthPt,
    drawHeightPt,
    undefined,
    'NONE',
  );

  const pdfBlob = pdfDocument.output('blob');
  return new File([pdfBlob], buildPdfFileName(imageFile.name), {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
};
