import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import FolderSheet from '../components/FolderSheet';
import axios from 'axios';
import { BASE } from '../utils/api';
import { getSequentialName, confirmUsed, sanitise } from '../utils/naming';
import { suggestName } from '../utils/aiNaming';

// ─── Utilities ────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => res(img);
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = src;
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(b64);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ─── Image filter (applied on canvas at full res) ────────────────────────────
async function applyFilterToDataUrl(dataUrl, filter) {
  const img = await loadImg(dataUrl);
  const c   = document.createElement('canvas');
  c.width   = img.naturalWidth  || img.width;
  c.height  = img.naturalHeight || img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (filter === 'original') return c.toDataURL('image/jpeg', 0.98);

  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d  = id.data;

  if (filter === 'bw') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i] = d[i+1] = d[i+2] = g;
    }
  } else if (filter === 'enhance') {
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, Math.max(0, (d[i]   - 128) * 1.5 + 148));
      d[i+1] = Math.min(255, Math.max(0, (d[i+1] - 128) * 1.5 + 148));
      d[i+2] = Math.min(255, Math.max(0, (d[i+2] - 128) * 1.5 + 148));
    }
  } else if (filter === 'magic') {
    // High-contrast grayscale — "scanned document" look
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      g = g > 190 ? 255 : g < 60 ? 0 : ((g - 60) / 130) * 255;
      d[i] = d[i+1] = d[i+2] = Math.min(255, g);
    }
  }

  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.98);
}

// ─── Rotate CW at full resolution ────────────────────────────────────────────
async function rotateCW(dataUrl) {
  const img = await loadImg(dataUrl);
  const W   = img.naturalWidth  || img.width;
  const H   = img.naturalHeight || img.height;
  const c   = document.createElement('canvas');
  c.width   = H; c.height = W;
  const ctx = c.getContext('2d');
  ctx.translate(H / 2, W / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -W / 2, -H / 2);
  return c.toDataURL('image/jpeg', 0.98);
}

// ─── Perspective warp — proper strip-based approach, no pixelation ────────────
async function perspectiveCrop(originalDataUrl, pts) {
  const src = await loadImg(originalDataUrl);

  const W = Math.round((
    Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) +
    Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y)
  ) / 2);
  const H = Math.round((
    Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) +
    Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)
  ) / 2);

  const out = document.createElement('canvas');
  out.width  = W;
  out.height = H;
  const ctx  = out.getContext('2d');

  const ROWS = H;
  for (let row = 0; row < ROWS; row++) {
    const v = row / ROWS;

    const lx = pts[0].x + (pts[3].x - pts[0].x) * v;
    const ly = pts[0].y + (pts[3].y - pts[0].y) * v;
    const rx = pts[1].x + (pts[2].x - pts[1].x) * v;
    const ry = pts[1].y + (pts[2].y - pts[1].y) * v;

    const srcY = (ly + ry) / 2;
    const srcW = Math.hypot(rx - lx, ry - ly);
    const srcX = lx;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, row, W, 1);
    ctx.clip();

    const angle = Math.atan2(ry - ly, rx - lx);
    ctx.translate(0, row);
    ctx.rotate(-angle);
    ctx.drawImage(
      src,
      srcX, srcY - 0.5,
      Math.max(1, srcW), 1,
      0, 0,
      W, 1
    );
    ctx.restore();
  }

  return out.toDataURL('image/jpeg', 0.98);
}

// ─── Crop Editor ─────────────────────────────────────────────────────────────
function CropEditor({ page, onDone, onCancel }) {
  const [imgSize,  setImgSize]  = useState(null);
  const [dispSize, setDispSize] = useState(null);
  const [pts,      setPts]      = useState(null);
  const [dragging, setDragging] = useState(null);
  const [applying, setApplying] = useState(false);
  const containerRef = useRef();
  const svgRef       = useRef();

  useEffect(() => {
    const src = page.original;
    loadImg(src).then(img => {
      const IW = img.naturalWidth  || img.width;
      const IH = img.naturalHeight || img.height;
      setImgSize({ w: IW, h: IH });

      const vw = window.innerWidth;
      const vh = window.innerHeight - 160;
      const scale = Math.min((vw - 24) / IW, vh / IH, 1);
      const DW = Math.round(IW * scale);
      const DH = Math.round(IH * scale);
      setDispSize({ w: DW, h: DH });

      const M = 0.08;
      setPts([
        { x: IW * M,       y: IH * M },
        { x: IW * (1 - M), y: IH * M },
        { x: IW * (1 - M), y: IH * (1 - M) },
        { x: IW * M,       y: IH * (1 - M) },
      ]);
    }).catch(() => { onDone(page.processed || page.original); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toDisp = (ix, iy) => ({
    x: (ix / (imgSize?.w || 1)) * (dispSize?.w || 1),
    y: (iy / (imgSize?.h || 1)) * (dispSize?.h || 1),
  });

  const toImgCoords = (dx, dy) => ({
    x: (dx / (dispSize?.w || 1)) * (imgSize?.w || 1),
    y: (dy / (dispSize?.h || 1)) * (imgSize?.h || 1),
  });

  function getPos(e) {
    const svg  = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: Math.max(0, Math.min(dispSize.w, src.clientX - rect.left)),
      y: Math.max(0, Math.min(dispSize.h, src.clientY - rect.top)),
    };
  }

  function onDown(e, i) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(i);
  }

  function onMove(e) {
    if (dragging === null) return;
    e.preventDefault();
    const p = getPos(e);
    setPts(prev => prev.map((pt, i) => i === dragging ? toImgCoords(p.x, p.y) : pt));
  }

  function onUp() { setDragging(null); }

  async function apply() {
    setApplying(true);
    try {
      const cropped = await perspectiveCrop(page.original, pts);
      if (page.filter && page.filter !== 'original') {
        const filtered = await applyFilterToDataUrl(cropped, page.filter);
        onDone(filtered);
      } else {
        onDone(cropped);
      }
    } catch (err) {
      console.error('Crop failed:', err);
      onDone(page.processed || page.original);
    }
    setApplying(false);
  }

  if (!pts || !imgSize || !dispSize) {
    return (
      <div style={{ position:'fixed', inset:0, background:'#111', zIndex:400,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="spin" style={{ width:36, height:36,
          border:'2px solid rgba(255,255,255,.15)', borderTopColor:'white', borderRadius:'50%' }} />
      </div>
    );
  }

  const dp = pts.map(p => toDisp(p.x, p.y));
  const polyPts = dp.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ position:'fixed', inset:0, background:'#0a0a0a', zIndex:400,
      display:'flex', flexDirection:'column', touchAction:'none', userSelect:'none' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', paddingTop:'max(12px, env(safe-area-inset-top))', flexShrink:0 }}>
        <button onClick={onCancel} style={{
          background:'none', border:'none', color:'rgba(255,255,255,.7)',
          fontSize:15, cursor:'pointer', padding:'8px 12px', minWidth:64, minHeight:44,
          fontFamily:'var(--font)', textAlign:'left',
        }}>Cancel</button>
        <span style={{ color:'white', fontSize:14, fontWeight:600 }}>Adjust Crop</span>
        <button onClick={apply} disabled={applying} style={{
          background: applying ? 'rgba(204,120,92,.5)' : 'var(--accent)',
          border:'none', color:'white', fontSize:14, fontWeight:700,
          cursor: applying ? 'default' : 'pointer',
          padding:'9px 20px', borderRadius:99, minHeight:44, minWidth:64,
          fontFamily:'var(--font)',
        }}>
          {applying ? '…' : 'Done'}
        </button>
      </div>

      {/* Image + SVG overlay */}
      <div ref={containerRef} style={{ flex:1, display:'flex', alignItems:'center',
        justifyContent:'center', overflow:'hidden', position:'relative' }}>
        <div style={{ position:'relative', width:dispSize.w, height:dispSize.h }}>

          <img src={page.processed || page.original} alt="crop"
            style={{ width:dispSize.w, height:dispSize.h, display:'block',
              pointerEvents:'none', userSelect:'none' }} />

          <svg
            ref={svgRef}
            width={dispSize.w} height={dispSize.h}
            style={{ position:'absolute', top:0, left:0, touchAction:'none', overflow:'visible' }}
            onMouseMove={onMove}  onMouseUp={onUp}  onMouseLeave={onUp}
            onTouchMove={onMove}  onTouchEnd={onUp}
          >
            <defs>
              <mask id="crop-mask">
                <rect width="100%" height="100%" fill="white" />
                <polygon points={polyPts} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,.6)" mask="url(#crop-mask)" />

            <polygon points={polyPts} fill="none" stroke="white" strokeWidth="1.8" />

            {[1/3, 2/3].map(t => {
              const top_l = { x: dp[0].x + (dp[3].x - dp[0].x)*t, y: dp[0].y + (dp[3].y - dp[0].y)*t };
              const top_r = { x: dp[1].x + (dp[2].x - dp[1].x)*t, y: dp[1].y + (dp[2].y - dp[1].y)*t };
              const left  = { x: dp[0].x + (dp[1].x - dp[0].x)*t, y: dp[0].y + (dp[1].y - dp[0].y)*t };
              const right = { x: dp[3].x + (dp[2].x - dp[3].x)*t, y: dp[3].y + (dp[2].y - dp[3].y)*t };
              return (
                <g key={t}>
                  <line x1={top_l.x} y1={top_l.y} x2={top_r.x} y2={top_r.y}
                    stroke="rgba(255,255,255,.4)" strokeWidth="0.8" strokeDasharray="5,4" />
                  <line x1={left.x}  y1={left.y}  x2={right.x} y2={right.y}
                    stroke="rgba(255,255,255,.4)" strokeWidth="0.8" strokeDasharray="5,4" />
                </g>
              );
            })}

            {dp.map((p, i) => {
              const arms = [
                [[1,0],[0,1]],
                [[-1,0],[0,1]],
                [[-1,0],[0,-1]],
                [[1,0],[0,-1]],
              ][i];
              const L = 22;
              return (
                <g key={i}
                  onMouseDown={e => onDown(e, i)}
                  onTouchStart={e => onDown(e, i)}
                  style={{ cursor:'grab', touchAction:'none' }}>
                  <circle cx={p.x} cy={p.y} r={28} fill="transparent" />
                  {arms.map(([dx,dy], ai) => (
                    <line key={'s'+ai}
                      x1={p.x} y1={p.y} x2={p.x+dx*L} y2={p.y+dy*L}
                      stroke="rgba(0,0,0,.5)" strokeWidth="5" strokeLinecap="round" />
                  ))}
                  {arms.map(([dx,dy], ai) => (
                    <line key={ai}
                      x1={p.x} y1={p.y} x2={p.x+dx*L} y2={p.y+dy*L}
                      stroke="white" strokeWidth="3" strokeLinecap="round" />
                  ))}
                  <circle cx={p.x} cy={p.y} r={6} fill="white"
                    stroke="rgba(0,0,0,.3)" strokeWidth="1.5" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <p style={{ textAlign:'center', color:'rgba(255,255,255,.35)',
        fontSize:12, padding:'10px 16px 16px', flexShrink:0, fontFamily:'var(--font)' }}>
        Drag corners to align with document edges
      </p>
    </div>
  );
}

// ─── Camera Capture ───────────────────────────────────────────────────────────
function CameraCapture({ onCapture, onClose }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready,  setReady]  = useState(false);
  const [flash,  setFlash]  = useState(false);
  const [error,  setError]  = useState('');
  const [torch,  setTorch]  = useState(false);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 4096 },
            height: { ideal: 3072 },
          },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play().then(() => { if (active) setReady(true); }).catch(() => {
              if (active) setReady(true);
            });
          };
        }
      } catch (e) {
        if (!active) return;
        const msg = e.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : e.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : 'Camera error: ' + e.message;
        setError(msg);
      }
    }

    start();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const setVideoRef = (el) => {
    videoRef.current = el;
    if (el && streamRef.current && !el.srcObject) {
      el.srcObject = streamRef.current;
    }
  };

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
    const c = document.createElement('canvas');
    c.width  = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.98));
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    track.applyConstraints({ advanced: [{ torch: next }] })
      .then(() => setTorch(next))
      .catch(() => {});
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, background:'#000',
      display:'flex', flexDirection:'column', userSelect:'none', touchAction:'none' }}>

      {flash && (
        <div style={{ position:'absolute', inset:0, background:'white',
          opacity:.8, zIndex:20, pointerEvents:'none',
          animation:'fadeInBg .2s ease' }} />
      )}

      <video
        ref={setVideoRef}
        autoPlay playsInline muted
        style={{ position:'absolute', inset:0, width:'100%', height:'100%',
          objectFit:'cover', display:'block' }}
      />

      <div style={{
        position:'absolute', top:0, left:0, right:0, zIndex:10,
        background:'linear-gradient(180deg,rgba(0,0,0,.65) 0%,transparent 100%)',
        padding:'max(env(safe-area-inset-top,12px),12px) 12px 24px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <button onClick={onClose} style={{
          width:48, height:48, display:'flex', alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,.35)', backdropFilter:'blur(4px)',
          border:'none', borderRadius:99, color:'white', fontSize:22,
          cursor:'pointer', WebkitTapHighlightColor:'transparent',
        }}>✕</button>

        <div style={{ color:'rgba(255,255,255,.8)', fontSize:13,
          fontFamily:'var(--font)', fontWeight:500, textAlign:'center' }}>
          {error ? '' : 'Position document in frame'}
        </div>

        <button onClick={toggleTorch} style={{
          width:48, height:48, display:'flex', alignItems:'center', justifyContent:'center',
          background: torch ? 'rgba(255,208,60,.2)' : 'rgba(0,0,0,.35)',
          backdropFilter:'blur(4px)',
          border: torch ? '1.5px solid rgba(255,208,60,.6)' : 'none',
          borderRadius:99, color: torch ? '#FFD060' : 'white', fontSize:20,
          cursor:'pointer', WebkitTapHighlightColor:'transparent',
        }}>⚡</button>
      </div>

      {error && (
        <div style={{ position:'absolute', inset:0, zIndex:15,
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding:'32px', textAlign:'center' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📷</div>
          <p style={{ color:'white', fontSize:15, marginBottom:8, fontFamily:'var(--font)' }}>{error}</p>
          <button onClick={onClose} style={{
            marginTop:16, padding:'12px 24px', borderRadius:99,
            background:'white', color:'#333', border:'none', fontSize:14,
            cursor:'pointer', fontFamily:'var(--font)', fontWeight:600,
          }}>Go Back</button>
        </div>
      )}

      {!error && (
        <div style={{ position:'absolute', inset:0, zIndex:8, pointerEvents:'none' }}>
          {[
            { top:'14%',   left:'8%',   borderTop:'2.5px solid rgba(255,255,255,.75)', borderLeft:'2.5px solid rgba(255,255,255,.75)' },
            { top:'14%',   right:'8%',  borderTop:'2.5px solid rgba(255,255,255,.75)', borderRight:'2.5px solid rgba(255,255,255,.75)' },
            { bottom:'24%',left:'8%',   borderBottom:'2.5px solid rgba(255,255,255,.75)', borderLeft:'2.5px solid rgba(255,255,255,.75)' },
            { bottom:'24%',right:'8%',  borderBottom:'2.5px solid rgba(255,255,255,.75)', borderRight:'2.5px solid rgba(255,255,255,.75)' },
          ].map((s, i) => (
            <div key={i} style={{ position:'absolute', width:32, height:32, ...s }} />
          ))}
        </div>
      )}

      {ready && !error && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, zIndex:10,
          paddingBottom:'max(env(safe-area-inset-bottom,0px),24px)',
          paddingTop:24,
          background:'linear-gradient(0deg,rgba(0,0,0,.7) 0%,transparent 100%)',
          display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        }}>
          <span style={{ color:'rgba(255,255,255,.5)', fontSize:12,
            fontFamily:'var(--font)', letterSpacing:'.04em' }}>
            TAP TO CAPTURE
          </span>

          <button
            onClick={shoot}
            style={{
              width:80, height:80, borderRadius:'50%',
              border:'3px solid rgba(255,255,255,.9)',
              background:'transparent', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              WebkitTapHighlightColor:'transparent', touchAction:'manipulation',
              transition:'transform .12s, border-color .12s',
              position:'relative',
            }}
            onTouchStart={e => { e.currentTarget.style.transform='scale(.9)'; e.currentTarget.style.borderColor='var(--accent)'; }}
            onTouchEnd={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.borderColor='rgba(255,255,255,.9)'; }}
          >
            <div style={{
              width:62, height:62, borderRadius:'50%',
              background:'white',
              boxShadow:'0 2px 12px rgba(0,0,0,.4)',
            }} />
          </button>
        </div>
      )}

      {!ready && !error && (
        <div style={{ position:'absolute', inset:0, zIndex:15, display:'flex',
          alignItems:'center', justifyContent:'center' }}>
          <div style={{ textAlign:'center' }}>
            <div className="spin" style={{ width:36, height:36,
              border:'2px solid rgba(255,255,255,.15)', borderTopColor:'white',
              borderRadius:'50%', margin:'0 auto 12px' }} />
            <p style={{ color:'rgba(255,255,255,.5)', fontSize:13,
              fontFamily:'var(--font)' }}>Starting camera…</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page Thumbnail Strip ─────────────────────────────────────────────────────
function PageStrip({ pages, selected, onSelect, onCrop, onDelete, onAdd }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
      background:'rgba(0,0,0,.88)', overflowX:'auto', overflowY:'visible',
      WebkitOverflowScrolling:'touch', scrollbarWidth:'none', flexShrink:0,
    }}>
      {pages.map((p, i) => (
        <div key={p.id} style={{ position:'relative', flexShrink:0 }}>
          <div
            onClick={() => onSelect(i)}
            style={{
              width:50, height:66, borderRadius:6, overflow:'hidden', cursor:'pointer',
              border:`2.5px solid ${selected===i ? 'var(--accent)' : 'rgba(255,255,255,.18)'}`,
              transition:'border-color .15s',
            }}>
            <img src={p.processed || p.original} alt={`p${i+1}`}
              style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            <div style={{
              position:'absolute', bottom:0, left:0, right:0,
              background:'rgba(0,0,0,.65)', color:'white',
              fontSize:9, textAlign:'center', padding:'2px 0',
              fontFamily:'var(--font)',
            }}>{i+1}</div>
          </div>
          <button onClick={() => onCrop(i)}
            style={{
              position:'absolute', top:-6, left:-6, width:22, height:22,
              borderRadius:'50%', background:'rgba(40,40,40,.9)',
              border:'1.5px solid rgba(255,255,255,.3)',
              color:'white', fontSize:11, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              WebkitTapHighlightColor:'transparent', zIndex:2,
            }}>✂</button>
          <button onClick={() => onDelete(i)}
            style={{
              position:'absolute', top:-6, right:-6, width:22, height:22,
              borderRadius:'50%', background:'rgba(180,30,30,.9)',
              border:'1.5px solid rgba(255,255,255,.2)',
              color:'white', fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              WebkitTapHighlightColor:'transparent', zIndex:2,
            }}>×</button>
        </div>
      ))}
      <button onClick={onAdd} style={{
        minWidth:50, width:50, height:66, borderRadius:6, flexShrink:0,
        border:'2px dashed rgba(255,255,255,.22)', background:'rgba(255,255,255,.05)',
        cursor:'pointer', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:2,
        WebkitTapHighlightColor:'transparent',
      }}>
        <span style={{ fontSize:22, color:'rgba(255,255,255,.5)', lineHeight:1 }}>＋</span>
        <span style={{ fontSize:9, color:'rgba(255,255,255,.35)', fontFamily:'var(--font)' }}>Add</span>
      </button>
    </div>
  );
}

// ─── Build PDF with centred, high-quality images ──────────────────────────────
async function buildPDF(pages) {
  const { jsPDF } = await import('jspdf');

  const PW = 595.28, PH = 841.89;
  const MARGIN = 20;

  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4', compress:true });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();

    const dataUrl = pages[i].processed || pages[i].original;
    const img     = await loadImg(dataUrl);
    const IW      = img.naturalWidth  || img.width;
    const IH      = img.naturalHeight || img.height;

    const maxW = PW - MARGIN * 2;
    const maxH = PH - MARGIN * 2;

    const scale = Math.min(maxW / IW, maxH / IH);
    const drawW = IW * scale;
    const drawH = IH * scale;

    const x = (PW - drawW) / 2;
    const y = (PH - drawH) / 2;

    const fmt = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    pdf.addImage(dataUrl, fmt, x, y, drawW, drawH, undefined, 'NONE');
  }

  return pdf.output('blob');
}

// ─── Main ScannerPage ─────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { getAuthHeader } = useAuth();
  const navigate          = useNavigate();
  const fileInputRef      = useRef();

  const [pages,      setPages]      = useState([]);
  const [selected,   setSelected]   = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [cropIndex,  setCropIndex]  = useState(null);
  const [showFolder, setShowFolder] = useState(false);
  const [docName,    setDocName]    = useState('');
  const [outputFmt,  setOutputFmt]  = useState('pdf');
  const [folder,     setFolder]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')); } catch { return null; }
  });
  const [uploading,  setUploading]  = useState(false);
  const [uploadDone, setUploadDone] = useState(null);
  const [error,      setError]      = useState('');

  function addPage(original) {
    const p = { id: uid(), original, processed: original, filter: 'original' };
    setPages(prev => { const next = [...prev, p]; return next; });
    setSelected(prev => prev);
    return p;
  }

  function handleFiles(fileList) {
    Array.from(fileList)
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .forEach(file => {
        const reader = new FileReader();
        reader.onload = e => addPage(e.target.result);
        reader.readAsDataURL(file);
      });
  }

  function handleCamera(dataUrl) {
    const p = addPage(dataUrl);
    setShowCamera(false);
    setPages(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      setCropIndex(idx >= 0 ? idx : prev.length - 1);
      return prev;
    });
    setTimeout(() => {
      setPages(prev => {
        const idx = prev.findIndex(x => x.id === p.id);
        if (idx >= 0) setCropIndex(idx);
        return prev;
      });
    }, 50);
  }

  function applyCrop(idx, croppedUrl) {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: croppedUrl } : p));
    setCropIndex(null);
  }

  function deletePage(idx) {
    setPages(prev => prev.filter((_, i) => i !== idx));
    setSelected(s => Math.max(0, s > idx ? s-1 : Math.min(s, pages.length-2)));
    if (cropIndex === idx) setCropIndex(null);
  }

  async function applyFilter(idx, filter) {
    const page = pages[idx];
    const result = await applyFilterToDataUrl(page.processed, filter);
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: result, filter } : p));
  }

  async function rotate(idx) {
    const page   = pages[idx];
    const result = await rotateCW(page.processed);
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: result } : p));
  }

  function movePage(from, dir) {
    const to = from + dir;
    if (to < 0 || to >= pages.length) return;
    setPages(prev => {
      const a = [...prev]; [a[from], a[to]] = [a[to], a[from]]; return a;
    });
    setSelected(to);
  }

  async function saveAndUpload() {
    if (!pages.length)  { setError('Add at least one page.'); return; }
    if (!folder)        { setShowFolder(true); return; }
    setUploading(true); setError('');

    try {
      let blob, ext;  // ← REMOVED `mimeType`

      if (outputFmt === 'pdf') {
        blob = await buildPDF(pages);
        ext  = '.pdf';
      } else {
        if (pages.length > 1) {
          blob = await buildPDF(pages);
          ext  = '.pdf';
        } else {
          const dataUrl = pages[0].processed || pages[0].original;
          const q       = outputFmt === 'jpg' ? 'image/jpeg' : 'image/png';
          const canvas  = document.createElement('canvas');
          const img     = await loadImg(dataUrl);
          canvas.width  = img.naturalWidth  || img.width;
          canvas.height = img.naturalHeight || img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
          blob = await new Promise(r => canvas.toBlob(r, q, 0.98));
          ext = outputFmt === 'jpg' ? '.jpg' : '.png';
        }
      }

      let name = docName.trim();
      if (!name) {
        const firstBlob = dataUrlToBlob(pages[0].processed || pages[0].original);
        const firstFile = new File([firstBlob], 'scan.jpg', { type:'image/jpeg' });
        const aiName    = await suggestName(firstFile, folder.path).catch(() => null);
        name = aiName ? sanitise(aiName) : getSequentialName(folder.path, ext).replace(ext, '');
      }
      const fileName = name.replace(/\.[^.]+$/, '') + ext;

      const form = new FormData();
      form.append('document',   blob, fileName);
      form.append('folderPath', folder.path);
      form.append('customName', fileName);

      const h = await getAuthHeader();
      const { data } = await axios.post(`${BASE}/upload`, form, {
        headers: { Authorization: h, 'Content-Type': 'multipart/form-data' },
      });

      confirmUsed(folder.path);
      localStorage.setItem('dv_last_folder', JSON.stringify(folder));
      setUploadDone({ ...data.file, fileName });
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  }

  const activePage = pages[selected] || pages[0];

  if (cropIndex !== null && pages[cropIndex]) {
    return (
      <CropEditor
        page={pages[cropIndex]}
        onDone={url => applyCrop(cropIndex, url)}
        onCancel={() => setCropIndex(null)}
      />
    );
  }

  if (uploadDone) {
    return (
      <div className="page" style={{ background:'var(--cream)' }}>
        <Navbar />
        <div style={{ maxWidth:440, margin:'0 auto', padding:'52px 20px', textAlign:'center' }}>
          <div style={{ fontSize:60, marginBottom:16 }}>✅</div>
          <h2 style={{ marginBottom:8 }}>Saved to Drive!</h2>
          <p style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--ink-3)', marginBottom:4 }}>
            {uploadDone.fileName || uploadDone.name}
          </p>
          <p style={{ fontSize:12, color:'var(--ink-4)', marginBottom:28 }}>
            DocVault/{folder?.path}
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {uploadDone.viewLink && (
              <a href={uploadDone.viewLink} target="_blank" rel="noopener noreferrer"
                style={{ padding:'14px', borderRadius:14, background:'var(--accent)',
                  color:'white', textDecoration:'none', fontSize:15, fontWeight:700,
                  fontFamily:'var(--font)', display:'block' }}>
                Open in Drive ↗
              </a>
            )}
            <button onClick={() => { setPages([]); setUploadDone(null); setDocName(''); setSelected(0); }}
              style={{ padding:'13px', borderRadius:14, border:'1.5px solid var(--border)',
                background:'white', fontSize:15, cursor:'pointer', fontFamily:'var(--font)' }}>
              Scan another document
            </button>
            <button onClick={() => navigate('/dashboard')}
              style={{ padding:'11px', borderRadius:14, border:'none', background:'none',
                fontSize:14, color:'var(--ink-3)', cursor:'pointer', fontFamily:'var(--font)' }}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height:'100dvh', background:'#111',
      display:'flex', flexDirection:'column', overflow:'hidden',
      paddingBottom:'var(--bottom-bar-h)' }}>
      <Navbar darkBg />

      {pages.length === 0 && (
        <div style={{ flex:1, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', gap:20, padding:'32px 24px' }}>
          <div style={{ fontSize:56, opacity:.2 }}>📄</div>
          <p style={{ color:'rgba(255,255,255,.4)', fontSize:15, fontFamily:'var(--font)' }}>
            No pages yet
          </p>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
            <button onClick={() => setShowCamera(true)} style={{
              padding:'14px 24px', borderRadius:14,
              background:'var(--accent)', color:'white', border:'none',
              fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)',
              minHeight:52, display:'flex', alignItems:'center', gap:8,
              WebkitTapHighlightColor:'transparent',
            }}>📷 Use Camera</button>
            <button onClick={() => fileInputRef.current?.click()} style={{
              padding:'14px 24px', borderRadius:14,
              background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.85)',
              border:'1.5px solid rgba(255,255,255,.18)',
              fontSize:15, cursor:'pointer', fontFamily:'var(--font)',
              minHeight:52, display:'flex', alignItems:'center', gap:8,
              WebkitTapHighlightColor:'transparent',
            }}>🖼 Gallery</button>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
            style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
        </div>
      )}

      {pages.length > 0 && activePage && (
        <>
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
            padding:'10px', minHeight:0, position:'relative' }}>
            <img src={activePage.processed || activePage.original} alt="preview"
              style={{
                maxWidth:'100%',
                maxHeight:'calc(100dvh - 310px)',
                objectFit:'contain', borderRadius:7,
                boxShadow:'0 6px 32px rgba(0,0,0,.65)', display:'block',
              }} />
            <button onClick={() => setCropIndex(selected)} style={{
              position:'absolute', top:18, right:18,
              background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)',
              border:'none', color:'white', borderRadius:99,
              padding:'7px 14px', fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font)',
              WebkitTapHighlightColor:'transparent',
            }}>✂️ Crop</button>
          </div>

          <div style={{ display:'flex', gap:7, padding:'7px 12px',
            overflowX:'auto', WebkitOverflowScrolling:'touch', scrollbarWidth:'none',
            background:'rgba(0,0,0,.55)', flexShrink:0 }}>
            {[
              { id:'original', label:'Original', icon:'📷' },
              { id:'enhance',  label:'Enhance',  icon:'✨' },
              { id:'bw',       label:'B&W',       icon:'⬛' },
              { id:'magic',    label:'Magic',     icon:'🪄' },
            ].map(f => (
              <button key={f.id} onClick={() => applyFilter(selected, f.id)} style={{
                padding:'7px 13px', borderRadius:99, border:'none', cursor:'pointer',
                background: activePage.filter === f.id ? 'var(--accent)' : 'rgba(255,255,255,.1)',
                color: activePage.filter === f.id ? 'white' : 'rgba(255,255,255,.75)',
                fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap',
                fontWeight: activePage.filter === f.id ? 600 : 400, minHeight:34,
                WebkitTapHighlightColor:'transparent', display:'flex', alignItems:'center', gap:5,
              }}>{f.icon} {f.label}</button>
            ))}
            <div style={{ width:1, background:'rgba(255,255,255,.12)', margin:'0 2px', flexShrink:0 }} />
            <button onClick={() => rotate(selected)} style={{
              padding:'7px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.75)',
              fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34,
              WebkitTapHighlightColor:'transparent',
            }}>↻ Rotate</button>
            <button onClick={() => movePage(selected,-1)} disabled={selected===0} style={{
              padding:'7px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.1)',
              color: selected===0 ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.75)',
              fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34,
              WebkitTapHighlightColor:'transparent',
            }}>← Move</button>
            <button onClick={() => movePage(selected,1)} disabled={selected===pages.length-1} style={{
              padding:'7px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.1)',
              color: selected===pages.length-1 ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.75)',
              fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34,
              WebkitTapHighlightColor:'transparent',
            }}>Move →</button>
          </div>

          <PageStrip
            pages={pages} selected={selected}
            onSelect={setSelected}
            onCrop={i => setCropIndex(i)}
            onDelete={deletePage}
            onAdd={() => setShowCamera(true)}
          />

          <div style={{ background:'white', padding:'11px 13px',
            borderTop:'1px solid var(--border-soft)', flexShrink:0 }}>

            <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
              <input value={docName} onChange={e => setDocName(e.target.value)}
                placeholder="Name (auto if blank)…"
                style={{
                  flex:1, padding:'10px 12px',
                  border:'1.5px solid var(--border)', borderRadius:10,
                  fontFamily:'var(--font)', fontSize:16, outline:'none',
                  background:'var(--paper)', color:'var(--ink)', minHeight:44,
                }} />
              <button onClick={() => fileInputRef.current?.click()} style={{
                width:44, height:44, borderRadius:10,
                border:'1px solid var(--border)', background:'var(--paper)',
                cursor:'pointer', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0, WebkitTapHighlightColor:'transparent',
              }}>＋</button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
                style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
            </div>

            <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'stretch' }}>
              <div style={{ display:'flex', gap:4, background:'var(--sand)', borderRadius:9, padding:3, flexShrink:0 }}>
                {['pdf','jpg','png'].map(fmt => (
                  <button key={fmt} onClick={() => setOutputFmt(fmt)} style={{
                    padding:'5px 10px', borderRadius:7,
                    background: outputFmt===fmt ? 'white' : 'transparent',
                    border:'none', cursor:'pointer',
                    fontSize:12, fontWeight: outputFmt===fmt ? 700 : 400,
                    color: outputFmt===fmt ? 'var(--ink)' : 'var(--ink-3)',
                    fontFamily:'var(--font)', minHeight:34, textTransform:'uppercase',
                    boxShadow: outputFmt===fmt ? '0 1px 4px rgba(0,0,0,.12)' : 'none',
                    WebkitTapHighlightColor:'transparent',
                  }}>{fmt}</button>
                ))}
              </div>

              <button onClick={() => setShowFolder(true)} style={{
                flex:1, textAlign:'left', padding:'7px 12px',
                border:`1.5px solid ${folder ? 'var(--accent-light)' : '#e8a040'}`,
                background: folder ? 'var(--accent-bg)' : '#fff8ee',
                borderRadius:9, cursor:'pointer', fontFamily:'var(--font)',
                display:'flex', alignItems:'center', gap:7, minHeight:44,
                WebkitTapHighlightColor:'transparent', overflow:'hidden',
              }}>
                <span style={{ fontSize:15, flexShrink:0 }}>📂</span>
                <span style={{ fontSize:12, color: folder ? 'var(--accent)' : '#9a6010',
                  flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {folder ? `DocVault/${folder.path}` : 'Choose folder'}
                </span>
                <span style={{ fontSize:13, color:'var(--ink-4)', flexShrink:0 }}>›</span>
              </button>
            </div>

            {pages.length > 1 && outputFmt !== 'pdf' && (
              <p style={{ fontSize:11, color:'var(--amber)', marginBottom:6 }}>
                ⚠️ Multiple pages will be saved as PDF regardless
              </p>
            )}

            {error && <p style={{ fontSize:12, color:'var(--red)', marginBottom:6 }}>⚠ {error}</p>}

            <button onClick={saveAndUpload} disabled={uploading} style={{
              width:'100%', padding:'14px', borderRadius:13,
              background: uploading ? 'var(--accent-light)' : 'var(--accent)',
              color:'white', border:'none', fontSize:15, fontWeight:700,
              cursor: uploading ? 'default' : 'pointer', fontFamily:'var(--font)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              minHeight:52, WebkitTapHighlightColor:'transparent',
            }}>
              {uploading
                ? <><span className="spin" style={{ display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} /> Building {outputFmt.toUpperCase()}…</>
                : `Save ${pages.length}p as ${outputFmt.toUpperCase()} →`
              }
            </button>
          </div>
        </>
      )}

      {showCamera && (
        <CameraCapture
          onCapture={handleCamera}
          onClose={() => setShowCamera(false)}
        />
      )}

      {showFolder && (
        <FolderSheet
          getAuthHeader={getAuthHeader}
          lastUsedFolderId={folder?.id}
          onSelect={f => { setFolder(f); setShowFolder(false); }}
          onClose={() => setShowFolder(false)}
        />
      )}
    </div>
  );
}