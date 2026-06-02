/**
 * Perspective crop — bilinear inverse mapping.
 *
 * For every pixel in the output canvas we compute EXACTLY which
 * source pixel it came from by inverting the bilinear transform.
 * This guarantees zero black regions and smooth gradients.
 *
 * pts order: [TL, TR, BR, BL] in IMAGE-space pixels.
 */

function lerp(a, b, t) { return a + (b - a) * t; }

export async function perspectiveCrop(originalDataUrl, pts) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const IW = img.naturalWidth  || img.width;
      const IH = img.naturalHeight || img.height;

      // ── Draw full source image into an offscreen canvas ──────────────────
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width  = IW;
      srcCanvas.height = IH;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(img, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, IW, IH).data;

      // ── Output dimensions: average of opposite edges ─────────────────────
      const W = Math.round((
        Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) +
        Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y)
      ) / 2);
      const H = Math.round((
        Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) +
        Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)
      ) / 2);

      const out    = document.createElement('canvas');
      out.width    = W;
      out.height   = H;
      const outCtx = out.getContext('2d');
      const outImg = outCtx.createImageData(W, H);
      const outData = outImg.data;

      // ── Bilinear inverse map ─────────────────────────────────────────────
      // For each output pixel (u,v) in [0,1]×[0,1]:
      //   source = TL*(1-u)*(1-v) + TR*u*(1-v) + BR*u*v + BL*(1-u)*v
      // Then sample source at that pixel with bilinear interpolation.

      for (let row = 0; row < H; row++) {
        const v = row / (H - 1 || 1);
        for (let col = 0; col < W; col++) {
          const u = col / (W - 1 || 1);

          // Bilinear interpolation of the 4 corner points
          const w00 = (1 - u) * (1 - v); // TL
          const w10 =      u  * (1 - v); // TR
          const w11 =      u  *      v;  // BR
          const w01 = (1 - u) *      v;  // BL

          const sx = w00*pts[0].x + w10*pts[1].x + w11*pts[2].x + w01*pts[3].x;
          const sy = w00*pts[0].y + w10*pts[1].y + w11*pts[2].y + w01*pts[3].y;

          // Clamp to source bounds
          const x0 = Math.max(0, Math.min(IW - 1, Math.floor(sx)));
          const y0 = Math.max(0, Math.min(IH - 1, Math.floor(sy)));
          const x1 = Math.min(IW - 1, x0 + 1);
          const y1 = Math.min(IH - 1, y0 + 1);
          const fx = sx - x0;
          const fy = sy - y0;

          // Bilinear sample from source
          const i00 = (y0 * IW + x0) * 4;
          const i10 = (y0 * IW + x1) * 4;
          const i01 = (y1 * IW + x0) * 4;
          const i11 = (y1 * IW + x1) * 4;

          const outIdx = (row * W + col) * 4;
          for (let c = 0; c < 3; c++) {
            const top    = lerp(srcData[i00+c], srcData[i10+c], fx);
            const bottom = lerp(srcData[i01+c], srcData[i11+c], fx);
            outData[outIdx + c] = Math.round(lerp(top, bottom, fy));
          }
          outData[outIdx + 3] = 255; // fully opaque
        }
      }

      outCtx.putImageData(outImg, 0, 0);
      resolve(out.toDataURL('image/jpeg', 0.98));
    };
    img.onerror = () => reject(new Error('Failed to load image for crop'));
    img.src = originalDataUrl;
  });
}

/**
 * Simple rectangular crop (no perspective).
 * pts: [TL, TR, BR, BL]
 */
export async function rectCrop(originalDataUrl, pts) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const minX = Math.max(0, Math.min(pts[0].x, pts[3].x));
      const minY = Math.max(0, Math.min(pts[0].y, pts[1].y));
      const maxX = Math.min(img.naturalWidth,  Math.max(pts[1].x, pts[2].x));
      const maxY = Math.min(img.naturalHeight, Math.max(pts[2].y, pts[3].y));
      const W = Math.round(maxX - minX);
      const H = Math.round(maxY - minY);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, minX, minY, W, H, 0, 0, W, H);
      resolve(c.toDataURL('image/jpeg', 0.98));
    };
    img.onerror = reject;
    img.src = originalDataUrl;
  });
}
