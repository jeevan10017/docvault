/**
 * imageProcessing.js — document-quality image enhancement pipeline
 *
 * Goal: match Adobe Scan / CamScanner output quality without any paid API.
 * All processing runs on Canvas 2D in the browser — zero network cost.
 *
 * Pipeline for "Document" mode (optimised for text clarity):
 *   1. Grayscale conversion (luminance-weighted)
 *   2. Gaussian blur (remove sensor noise)
 *   3. Unsharp mask (sharpen edges / text strokes)
 *   4. Adaptive threshold (separate text from background lighting variation)
 *   5. Slight gamma correction (ensure pure white background)
 *
 * The result: crisp black text on pure white — like a photocopier scan.
 */

export function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = src;
  });
}

// ─── Convolution kernel helper ────────────────────────────────────────────────
function convolve(src, width, height, kernel, kSize) {
  const half   = Math.floor(kSize / 2);
  const output = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const sy = Math.min(height-1, Math.max(0, y + ky - half));
          const sx = Math.min(width-1,  Math.max(0, x + kx - half));
          const si = (sy * width + sx) * 4;
          const w  = kernel[ky * kSize + kx];
          r += src[si]   * w;
          g += src[si+1] * w;
          b += src[si+2] * w;
          wsum += w;
        }
      }
      const di = (y * width + x) * 4;
      const wn = wsum || 1;
      output[di]   = Math.min(255, Math.max(0, r / wn));
      output[di+1] = Math.min(255, Math.max(0, g / wn));
      output[di+2] = Math.min(255, Math.max(0, b / wn));
      output[di+3] = src[di+3];
    }
  }
  return output;
}

// 5×5 Gaussian kernel (sigma ≈ 1.0)
const GAUSSIAN_5 = [
  1, 4,  7,  4,  1,
  4, 16, 26, 16, 4,
  7, 26, 41, 26, 7,
  4, 16, 26, 16, 4,
  1, 4,  7,  4,  1,
];

// ─── Core processing functions ────────────────────────────────────────────────

/** Convert to grayscale using perceptual luminance weights */
function toGrayscale(d) {
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    d[i] = d[i+1] = d[i+2] = g;
  }
}

/** Unsharp mask: sharpened = original + amount × (original - blurred) */
function unsharpMask(original, blurred, width, height, amount = 1.2) {
  const out = new Uint8ClampedArray(original.length);
  for (let i = 0; i < original.length; i += 4) {
    out[i]   = Math.min(255, Math.max(0, original[i]   + amount * (original[i]   - blurred[i])));
    out[i+1] = Math.min(255, Math.max(0, original[i+1] + amount * (original[i+1] - blurred[i+1])));
    out[i+2] = Math.min(255, Math.max(0, original[i+2] + amount * (original[i+2] - blurred[i+2])));
    out[i+3] = original[i+3];
  }
  return out;
}

/**
 * Adaptive threshold — local mean-based binarisation.
 * Each pixel is compared to the mean of a neighbourhood.
 * This handles uneven lighting (phone held at angle, shadow on doc).
 *
 * blockSize: size of neighbourhood square (must be odd)
 * C: constant subtracted from mean (controls threshold sensitivity)
 */
function adaptiveThreshold(d, width, height, blockSize = 21, C = 10) {
  const half = Math.floor(blockSize / 2);
  // Build integral image for O(1) area sums
  const integral = new Float64Array((width+1) * (height+1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = d[(y*width+x)*4]; // grayscale — all channels equal
      integral[(y+1)*(width+1)+(x+1)] =
        v
        + integral[y*(width+1)+(x+1)]
        + integral[(y+1)*(width+1)+x]
        - integral[y*(width+1)+x];
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x-half);
      const y1 = Math.max(0, y-half);
      const x2 = Math.min(width-1, x+half);
      const y2 = Math.min(height-1, y+half);
      const area = (x2-x1+1) * (y2-y1+1);
      const sum  = integral[(y2+1)*(width+1)+(x2+1)]
                 - integral[(y1)*(width+1)+(x2+1)]
                 - integral[(y2+1)*(width+1)+x1]
                 + integral[y1*(width+1)+x1];
      const mean  = sum / area;
      const pixel = d[(y*width+x)*4];
      const val   = pixel < (mean - C) ? 0 : 255;
      const idx   = (y*width+x)*4;
      d[idx] = d[idx+1] = d[idx+2] = val;
    }
  }
}

/**
 * Gamma correction — brighten near-white areas to pure white.
 * Gamma < 1 brightens; gamma > 1 darkens.
 */
function gammaCorrect(d, gamma = 0.8) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(255 * Math.pow(i/255, gamma));
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = lut[d[i]];
    d[i+1] = lut[d[i+1]];
    d[i+2] = lut[d[i+2]];
  }
}

// ─── Filter presets ───────────────────────────────────────────────────────────

/**
 * "Document" — the main scanner filter.
 * Grayscale → denoise → sharpen → adaptive threshold → white bg.
 * Best for: printed text, handwritten notes, forms, ID cards.
 */
async function applyDocument(dataUrl) {
  const img = await loadImg(dataUrl);
  const W   = img.naturalWidth  || img.width;
  const H   = img.naturalHeight || img.height;

  // Work at 2× resolution if image is smaller than 1600px — improves OCR quality
  const targetW = W < 1600 ? W * 2 : W;
  const targetH = H < 1600 ? H * 2 : H;

  const c   = document.createElement('canvas');
  c.width   = targetW; c.height = targetH;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const id = ctx.getImageData(0, 0, targetW, targetH);
  const d  = id.data;

  // 1. Grayscale
  toGrayscale(d);

  // 2. Slight Gaussian blur to reduce noise
  const blurred = convolve(d, targetW, targetH, GAUSSIAN_5, 5);

  // 3. Unsharp mask (sharpen text edges)
  const sharpened = unsharpMask(d, blurred, targetW, targetH, 1.0);
  id.data.set(sharpened);

  // 4. Adaptive threshold — handles shadows, uneven lighting
  adaptiveThreshold(id.data, targetW, targetH, 25, 8);

  // 5. Gamma — whiten the background
  gammaCorrect(id.data, 0.75);

  ctx.putImageData(id, 0, 0);
  // PNG for document mode (lossless, sharper text)
  return c.toDataURL('image/png');
}

/**
 * "Enhance" — colour-preserved contrast boost.
 * Keeps colours (good for photos/drawings) but improves clarity.
 */
async function applyEnhance(dataUrl) {
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;
  // Contrast + brightness boost
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.min(255, Math.max(0, (d[i]  -128)*1.6+148));
    d[i+1] = Math.min(255, Math.max(0, (d[i+1]-128)*1.6+148));
    d[i+2] = Math.min(255, Math.max(0, (d[i+2]-128)*1.6+148));
  }
  // Unsharp mask over original
  const blurred = convolve(d, W, H, GAUSSIAN_5, 5);
  id.data.set(unsharpMask(d, blurred, W, H, 0.6));
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.97);
}

/**
 * "B&W" — grayscale with unsharp mask. Good for handwritten notes.
 */
async function applyBW(dataUrl) {
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  toGrayscale(id.data);
  const blurred = convolve(id.data, W, H, GAUSSIAN_5, 5);
  id.data.set(unsharpMask(id.data, blurred, W, H, 0.8));
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.97);
}

/**
 * "Magic" — like CamScanner's "Magic Colour": 
 * high-contrast with adaptive threshold, but keeps slight warmth.
 */
async function applyMagic(dataUrl) {
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;
  // Slight warmth reduction + contrast
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.min(255, d[i]   * 1.05);
    d[i+2] = Math.max(0,   d[i+2] * 0.90);
  }
  toGrayscale(d);
  const blurred = convolve(d, W, H, GAUSSIAN_5, 5);
  id.data.set(unsharpMask(d, blurred, W, H, 1.2));
  adaptiveThreshold(id.data, W, H, 31, 5);
  gammaCorrect(id.data, 0.85);
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

/** Main entry point — dispatch to the right filter */
export async function applyFilterToDataUrl(dataUrl, filter) {
  switch (filter) {
    case 'document': return applyDocument(dataUrl);
    case 'enhance':  return applyEnhance(dataUrl);
    case 'bw':       return applyBW(dataUrl);
    case 'magic':    return applyMagic(dataUrl);
    default:         return dataUrl; // 'original' — return as-is
  }
}

/**
 * Build a high-quality PDF from processed pages.
 * - Uses PNG for document/magic pages (lossless, crisp text)
 * - Uses JPEG for photo pages
 * - Each image is embedded at full resolution, not downscaled
 * - PDF is A4, image centred with 15pt margin
 */
export async function buildPDF(pages) {
  const { jsPDF } = await import('jspdf');
  const PW = 595.28, PH = 841.89, M = 15;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4', compress:false });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const dataUrl = pages[i].processed || pages[i].original;
    const img     = await loadImg(dataUrl);
    const IW = img.naturalWidth  || img.width;
    const IH = img.naturalHeight || img.height;

    // Fit image inside page margins keeping aspect ratio
    const scale = Math.min((PW - M*2) / IW, (PH - M*2) / IH);
    const dw = IW * scale;
    const dh = IH * scale;
    const x  = (PW - dw) / 2;
    const y  = (PH - dh) / 2;

    // PNG for lossless (document/magic filters), JPEG for colour pages
    const isLossless = dataUrl.startsWith('data:image/png');
    const fmt = isLossless ? 'PNG' : 'JPEG';

    // 'NONE' = no re-compression inside jsPDF (we already optimised the pixel data)
    pdf.addImage(dataUrl, fmt, x, y, dw, dh, `page${i}`, 'NONE');
  }

  return pdf.output('blob');
}
