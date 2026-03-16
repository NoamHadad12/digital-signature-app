import { jsPDF } from 'jspdf';

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
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

  // Preserve the source image resolution in canvas to keep maximum detail.
  const canvasWidthPx = Math.max(1, image.width);
  const canvasHeightPx = Math.max(1, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Unable to create a canvas context for conversion.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvasWidthPx, canvasHeightPx);

  const drawWidthPx = canvasWidthPx;
  const drawHeightPx = canvasHeightPx;
  const drawXPx = 0;
  const drawYPx = 0;

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

  const pdfWidth = pdfDocument.internal.pageSize.getWidth();
  const pdfHeight = pdfDocument.internal.pageSize.getHeight();
  const ratio = Math.min(pdfWidth / image.width, pdfHeight / image.height);
  const finalWidth = image.width * ratio;
  const finalHeight = image.height * ratio;
  const x = (pdfWidth - finalWidth) / 2;
  const y = (pdfHeight - finalHeight) / 2;

  pdfDocument.addImage(
    imageDataForPdf,
    embedFormat,
    x,
    y,
    finalWidth,
    finalHeight,
    undefined,
    'NONE',
  );

  const pdfBlob = pdfDocument.output('blob');
  return new File([pdfBlob], buildPdfFileName(imageFile.name), {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
};
