/**
 * imageProcessing.js — document-quality image enhancement
 *
 * Filters:
 *   original  — no change (pure passthrough)
 *   enhance   — colour contrast + sharpen (good for photos, posters, colour docs)
 *   bw        — grayscale + sharpen (handwritten notes)
 *   magic     — warm contrast + sharpen (great all-round)
 *   document  — adaptive threshold for TEXT documents only (forms, printed pages)
 *               Makes text crisp black on white — NOT suitable for colour photos
 *
 * Default after camera: 'original' — user picks the filter themselves.
 * Never auto-apply 'document' — it destroys colour content.
 */

export function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = src;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getCanvas(img, scale = 1) {
  const W = Math.round((img.naturalWidth  || img.width)  * scale);
  const H = Math.round((img.naturalHeight || img.height) * scale);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  return { c, ctx, W, H };
}

// 5×5 Gaussian kernel (sigma ≈ 1.0)
const G5 = [1,4,7,4,1, 4,16,26,16,4, 7,26,41,26,7, 4,16,26,16,4, 1,4,7,4,1];

function gaussianBlur(d, W, H) {
  const half = 2, norm = G5.reduce((a,b)=>a+b,0);
  const out = new Uint8ClampedArray(d.length);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    let r=0,g=0,b=0;
    for (let ky=0;ky<5;ky++) for (let kx=0;kx<5;kx++) {
      const sy=Math.min(H-1,Math.max(0,y+ky-half));
      const sx=Math.min(W-1, Math.max(0,x+kx-half));
      const si=(sy*W+sx)*4, w=G5[ky*5+kx];
      r+=d[si]*w; g+=d[si+1]*w; b+=d[si+2]*w;
    }
    const di=(y*W+x)*4;
    out[di]=r/norm; out[di+1]=g/norm; out[di+2]=b/norm; out[di+3]=d[di+3];
  }
  return out;
}

function unsharpMask(orig, blurred, amount=1.0) {
  const out = new Uint8ClampedArray(orig.length);
  for (let i=0;i<orig.length;i+=4) {
    out[i]  =Math.min(255,Math.max(0, orig[i]  +amount*(orig[i]  -blurred[i])));
    out[i+1]=Math.min(255,Math.max(0, orig[i+1]+amount*(orig[i+1]-blurred[i+1])));
    out[i+2]=Math.min(255,Math.max(0, orig[i+2]+amount*(orig[i+2]-blurred[i+2])));
    out[i+3]=orig[i+3];
  }
  return out;
}

function toGray(d) {
  for (let i=0;i<d.length;i+=4) {
    const g=Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]);
    d[i]=d[i+1]=d[i+2]=g;
  }
}

// Adaptive threshold using integral image — handles uneven lighting
function adaptiveThreshold(d, W, H, blockSize=25, C=8) {
  const half=Math.floor(blockSize/2);
  const intg=new Float64Array((W+1)*(H+1));
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const v=d[(y*W+x)*4];
    intg[(y+1)*(W+1)+(x+1)]=v+intg[y*(W+1)+(x+1)]+intg[(y+1)*(W+1)+x]-intg[y*(W+1)+x];
  }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const x1=Math.max(0,x-half),y1=Math.max(0,y-half);
    const x2=Math.min(W-1,x+half),y2=Math.min(H-1,y+half);
    const area=(x2-x1+1)*(y2-y1+1);
    const sum=intg[(y2+1)*(W+1)+(x2+1)]-intg[y1*(W+1)+(x2+1)]-intg[(y2+1)*(W+1)+x1]+intg[y1*(W+1)+x1];
    const idx=(y*W+x)*4;
    const val=d[idx]<(sum/area-C)?0:255;
    d[idx]=d[idx+1]=d[idx+2]=val;
  }
}

// ─── Filter implementations ────────────────────────────────────────────────────

// "Document" — for printed TEXT only: grayscale → sharpen → adaptive threshold
// Produces crisp black text on pure white. DO NOT use for colour photos.
async function applyDocument(dataUrl) {
  const img = await loadImg(dataUrl);
  // Scale up small images for better threshold quality
  const scale = (img.naturalWidth || img.width) < 1600 ? 1.5 : 1;
  const {c,ctx,W,H} = getCanvas(img, scale);
  const id = ctx.getImageData(0,0,W,H);
  toGray(id.data);
  const blurred = gaussianBlur(id.data,W,H);
  id.data.set(unsharpMask(id.data,blurred,1.2));
  adaptiveThreshold(id.data,W,H,25,8);
  ctx.putImageData(id,0,0);
  // JPEG for document — much smaller than PNG, text is still sharp
  return c.toDataURL('image/jpeg', 0.90);
}

// "Enhance" — colour contrast + sharpen. Good for photos, colour docs, posters.
async function applyEnhance(dataUrl) {
  const img = await loadImg(dataUrl);
  const {c,ctx,W,H} = getCanvas(img);
  const id = ctx.getImageData(0,0,W,H);
  const d  = id.data;
  for (let i=0;i<d.length;i+=4) {
    d[i]  =Math.min(255,Math.max(0,(d[i]  -128)*1.4+138));
    d[i+1]=Math.min(255,Math.max(0,(d[i+1]-128)*1.4+138));
    d[i+2]=Math.min(255,Math.max(0,(d[i+2]-128)*1.4+138));
  }
  const blurred=gaussianBlur(d,W,H);
  id.data.set(unsharpMask(d,blurred,0.7));
  ctx.putImageData(id,0,0);
  return c.toDataURL('image/jpeg', 0.88);
}

// "B&W" — grayscale + sharpen. Good for handwritten notes.
async function applyBW(dataUrl) {
  const img = await loadImg(dataUrl);
  const {c,ctx,W,H} = getCanvas(img);
  const id = ctx.getImageData(0,0,W,H);
  toGray(id.data);
  const blurred=gaussianBlur(id.data,W,H);
  id.data.set(unsharpMask(id.data,blurred,0.9));
  ctx.putImageData(id,0,0);
  return c.toDataURL('image/jpeg', 0.88);
}

// "Magic" — warm colour + contrast + sharpen. Good all-round.
async function applyMagic(dataUrl) {
  const img = await loadImg(dataUrl);
  const {c,ctx,W,H} = getCanvas(img);
  const id = ctx.getImageData(0,0,W,H);
  const d  = id.data;
  for (let i=0;i<d.length;i+=4) {
    d[i]  =Math.min(255,d[i]  *1.08);
    d[i+1]=Math.min(255,d[i+1]*1.04);
    d[i+2]=Math.max(0,  d[i+2]*0.92);
  }
  for (let i=0;i<d.length;i+=4) {
    d[i]  =Math.min(255,Math.max(0,(d[i]  -128)*1.35+138));
    d[i+1]=Math.min(255,Math.max(0,(d[i+1]-128)*1.35+138));
    d[i+2]=Math.min(255,Math.max(0,(d[i+2]-128)*1.35+138));
  }
  const blurred=gaussianBlur(d,W,H);
  id.data.set(unsharpMask(d,blurred,0.8));
  ctx.putImageData(id,0,0);
  return c.toDataURL('image/jpeg', 0.88);
}

/** Main entry point */
export async function applyFilterToDataUrl(dataUrl, filter) {
  try {
    switch (filter) {
      case 'document': return await applyDocument(dataUrl);
      case 'enhance':  return await applyEnhance(dataUrl);
      case 'bw':       return await applyBW(dataUrl);
      case 'magic':    return await applyMagic(dataUrl);
      default:         return dataUrl; // 'original' — no change
    }
  } catch (err) {
    console.error('Filter error:', err.message);
    return dataUrl; // graceful fallback — never crash
  }
}

/**
 * Build PDF from pages.
 *
 * Size optimisation:
 * - Max 1200px wide per page (enough for 150dpi on A4 — readable, small file)
 * - JPEG at 82% quality — good balance of clarity vs file size
 * - compress:true in jsPDF for PDF-level compression
 *
 * A typical scanned A4 page = 150-400KB.
 */
export async function buildPDF(pages) {
  const { jsPDF } = await import('jspdf');
  const PW=595.28, PH=841.89, M=15;
  const pdf=new jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
  const MAX_DIM=1200; // px — cap resolution to keep file small

  for (let i=0;i<pages.length;i++) {
    if (i>0) pdf.addPage();
    let dataUrl=pages[i].processed||pages[i].original;

    // Downscale large images before embedding
    try {
      const img=await loadImg(dataUrl);
      const IW=img.naturalWidth||img.width;
      const IH=img.naturalHeight||img.height;
      if (IW>MAX_DIM||IH>MAX_DIM) {
        const scale=Math.min(MAX_DIM/IW, MAX_DIM/IH);
        const cdown=document.createElement('canvas');
        cdown.width=Math.round(IW*scale);
        cdown.height=Math.round(IH*scale);
        const ctx=cdown.getContext('2d');
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality='high';
        ctx.drawImage(img,0,0,cdown.width,cdown.height);
        dataUrl=cdown.toDataURL('image/jpeg',0.82);
      }
      const img2=await loadImg(dataUrl);
      const W2=img2.naturalWidth||img2.width;
      const H2=img2.naturalHeight||img2.height;
      const scale2=Math.min((PW-M*2)/W2,(PH-M*2)/H2);
      const dw=W2*scale2, dh=H2*scale2;
      pdf.addImage(dataUrl,'JPEG',(PW-dw)/2,(PH-dh)/2,dw,dh,`p${i}`,'FAST');
    } catch(err) {
      console.error(`Page ${i} PDF error:`,err.message);
      // Skip this page rather than crashing the whole PDF
    }
  }
  return pdf.output('blob');
}
