import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Navbar from '../../components/Navbar';
import FolderSheet from '../../components/FolderSheet';
import axios from 'axios';
import { BASE } from '../../utils/api';
import { getSequentialName, confirmUsed, sanitise } from '../../utils/naming';
import { suggestName } from '../../utils/aiNaming';

// ─── tiny helpers ──────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function dataUrlToBlob(dataUrl) {
  const [h, d] = dataUrl.split(',');
  const mime   = h.match(/:(.*?);/)[1];
  const bin    = atob(d);
  const arr    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload  = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// ─── Image filters via Canvas ──────────────────────────────────────────────────
function applyFilter(canvas, filter) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d   = img.data;
  if (filter === 'bw') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i] = d[i+1] = d[i+2] = g;
    }
  } else if (filter === 'enhance') {
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, Math.max(0, (d[i]   - 128) * 1.45 + 148));
      d[i+1] = Math.min(255, Math.max(0, (d[i+1] - 128) * 1.45 + 148));
      d[i+2] = Math.min(255, Math.max(0, (d[i+2] - 128) * 1.45 + 148));
    }
  } else if (filter === 'magic') {
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      g = g > 185 ? 255 : g < 70 ? 0 : (g - 70) / 115 * 255;
      d[i] = d[i+1] = d[i+2] = Math.min(255, g);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.93);
}

async function rotateCW(dataUrl) {
  const img = await loadImg(dataUrl);
  const c   = document.createElement('canvas');
  c.width   = img.height; c.height = img.width;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return c.toDataURL('image/jpeg', 0.93);
}

/**
 * Perspective-correct crop using 4 corner points.
 * pts: [{x,y}, {x,y}, {x,y}, {x,y}] in image-space pixels (TL,TR,BR,BL)
 */
async function perspectiveCrop(dataUrl, pts) {
  const src  = await loadImg(dataUrl);
  const w    = Math.max(
    Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
    Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y)
  );
  const h    = Math.max(
    Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y),
    Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y)
  );
  const W    = Math.round(w), H = Math.round(h);
  const dst  = [{ x:0,y:0 }, { x:W,y:0 }, { x:W,y:H }, { x:0,y:H }];
  const c    = document.createElement('canvas');
  c.width    = W; c.height = H;
  const ctx  = c.getContext('2d');

  // Simple bilinear approximation (no WebGL needed)
  const temp = document.createElement('canvas');
  temp.width = src.naturalWidth || src.width;
  temp.height = src.naturalHeight || src.height;
  temp.getContext('2d').drawImage(src, 0, 0);

  // Subdivide into a grid and map each cell
  const STEPS = 80;
  for (let yi = 0; yi <= STEPS; yi++) {
    for (let xi = 0; xi <= STEPS; xi++) {
      const u = xi / STEPS, v = yi / STEPS;
      // Bilinear interpolate source position
      const sx = (1-u)*(1-v)*pts[0].x + u*(1-v)*pts[1].x + u*v*pts[2].x + (1-u)*v*pts[3].x;
      const sy = (1-u)*(1-v)*pts[0].y + u*(1-v)*pts[1].y + u*v*pts[2].y + (1-u)*v*pts[3].y;
      // Destination position
      const dx = u * W, dy = v * H;
      const px = temp.getContext('2d').getImageData(Math.round(sx), Math.round(sy), 1, 1).data;
      ctx.fillStyle = `rgba(${px[0]},${px[1]},${px[2]},${px[3]/255})`;
      ctx.fillRect(Math.round(dx), Math.round(dy), Math.ceil(W/STEPS)+1, Math.ceil(H/STEPS)+1);
    }
  }
  return c.toDataURL('image/jpeg', 0.93);
}

// ─── CropEditor — 4-corner handles + perspective warp ─────────────────────────
function CropEditor({ page, onDone, onCancel }) {
  const canvasRef  = useRef();
  const [imgSize,  setImgSize]  = useState({ w: 1, h: 1 });
  const [dispSize, setDispSize] = useState({ w: 300, h: 400 });
  const [pts,      setPts]      = useState(null); // [{x,y}×4] in IMAGE space
  const [dragging, setDragging] = useState(null); // index 0-3
  const [applying, setApplying] = useState(false);
  const containerRef = useRef();

  // Load image and set initial corner points
  useEffect(() => {
    const src = page.processed || page.original;
    loadImg(src).then(img => {
      const IW = img.naturalWidth  || img.width;
      const IH = img.naturalHeight || img.height;
      setImgSize({ w: IW, h: IH });

      // Default corners = 10% inset from image edges
      const m = 0.05;
      setPts([
        { x: IW*m,     y: IH*m },
        { x: IW*(1-m), y: IH*m },
        { x: IW*(1-m), y: IH*(1-m) },
        { x: IW*m,     y: IH*(1-m) },
      ]);

      // Fit image into container
      const container = containerRef.current;
      if (container) {
        const cw = container.clientWidth || window.innerWidth;
        // Available height: screen - toolbar - handle area - bottom bar
        const ch = window.innerHeight - 180;
        const ratio = Math.min(cw / IW, ch / IH);
        setDispSize({ w: Math.round(IW * ratio), h: Math.round(IH * ratio) });
      }
    });
  }, [page]);

  // Convert display coords → image coords
  function toImg(dx, dy) {
    const scale = imgSize.w / dispSize.w;
    return { x: dx * scale, y: dy * scale };
  }
  // Convert image coords → display coords
  function toDisp(ix, iy) {
    const scale = dispSize.w / imgSize.w;
    return { x: ix * scale, y: iy * scale };
  }

  function getEventPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  function onPointerDown(e, idx) {
    e.preventDefault();
    setDragging(idx);
  }

  function onPointerMove(e) {
    if (dragging === null || !pts) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const pos    = getEventPos(e, canvas);
    // Clamp to image display bounds
    const clampedX = Math.max(0, Math.min(dispSize.w, pos.x));
    const clampedY = Math.max(0, Math.min(dispSize.h, pos.y));
    const imgPos   = toImg(clampedX, clampedY);
    setPts(prev => prev.map((p, i) => i === dragging ? imgPos : p));
  }

  function onPointerUp() { setDragging(null); }

  async function applyAndDone() {
    setApplying(true);
    try {
      const src    = page.original; // always crop from original
      const result = await perspectiveCrop(src, pts);
      onDone(result);
    } catch (e) {
      console.error('Crop error:', e);
      onDone(page.processed); // fallback: no crop
    }
    setApplying(false);
  }

  if (!pts) return (
    <div style={{ position:'fixed', inset:0, background:'#111', zIndex:400, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="spin" style={{ width:32, height:32, border:'2px solid rgba(255,255,255,.2)', borderTopColor:'white', borderRadius:'50%' }} />
    </div>
  );

  const HANDLE_R = 20; // px, touch-friendly

  return (
    <div style={{ position:'fixed', inset:0, background:'#0d0d0d', zIndex:400, display:'flex', flexDirection:'column', userSelect:'none' }}>
      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', flexShrink:0 }}>
        <button onClick={onCancel}
          style={{ background:'none', border:'none', color:'rgba(255,255,255,.7)', fontSize:15, cursor:'pointer', padding:'8px', minWidth:44, minHeight:44, fontFamily:'var(--font)' }}>
          Cancel
        </button>
        <span style={{ color:'white', fontSize:14, fontWeight:500 }}>Adjust crop</span>
        <button onClick={applyAndDone} disabled={applying}
          style={{ background:'var(--accent)', border:'none', color:'white', fontSize:14, fontWeight:600, cursor:'pointer', padding:'8px 18px', borderRadius:99, minHeight:40, fontFamily:'var(--font)' }}>
          {applying ? '…' : 'Apply'}
        </button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'relative', width:dispSize.w, height:dispSize.h }}>
          {/* Image */}
          <img
            src={page.processed || page.original} alt="crop"
            style={{ width:dispSize.w, height:dispSize.h, display:'block', userSelect:'none', pointerEvents:'none' }}
          />

          {/* SVG overlay — polygon + grid */}
          <svg
            ref={canvasRef}
            width={dispSize.w} height={dispSize.h}
            style={{ position:'absolute', top:0, left:0, cursor:'crosshair', touchAction:'none' }}
            onMouseMove={onPointerMove}  onMouseUp={onPointerUp}
            onTouchMove={onPointerMove}  onTouchEnd={onPointerUp}
          >
            {/* Dark mask outside crop area */}
            <defs>
              <clipPath id="crop-clip">
                <polygon points={pts.map(p => `${toDisp(p.x,p.y).x},${toDisp(p.x,p.y).y}`).join(' ')} />
              </clipPath>
            </defs>
            {/* Full dark overlay */}
            <rect width={dispSize.w} height={dispSize.h} fill="rgba(0,0,0,.52)" />
            {/* Cut-out the crop region */}
            <polygon
              points={pts.map(p => `${toDisp(p.x,p.y).x},${toDisp(p.x,p.y).y}`).join(' ')}
              fill="rgba(0,0,0,0)"
              style={{ mixBlendMode:'destination-out' }}
            />
            {/* Border */}
            <polygon
              points={pts.map(p => `${toDisp(p.x,p.y).x},${toDisp(p.x,p.y).y}`).join(' ')}
              fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5"
            />

            {/* ── Rule-of-thirds grid lines (dashed) ── */}
            {(() => {
              const dp = pts.map(p => toDisp(p.x, p.y));
              const lines = [];
              for (let t of [1/3, 2/3]) {
                // Horizontal: lerp between left and right edges
                const lx = dp[0].x + (dp[3].x - dp[0].x) * t;
                const ly = dp[0].y + (dp[3].y - dp[0].y) * t;
                const rx = dp[1].x + (dp[2].x - dp[1].x) * t;
                const ry = dp[1].y + (dp[2].y - dp[1].y) * t;
                lines.push(<line key={`h${t}`} x1={lx} y1={ly} x2={rx} y2={ry} stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="5,5" />);

                // Vertical: lerp between top and bottom edges
                const tx = dp[0].x + (dp[1].x - dp[0].x) * t;
                const ty = dp[0].y + (dp[1].y - dp[0].y) * t;
                const bx = dp[3].x + (dp[2].x - dp[3].x) * t;
                const by = dp[3].y + (dp[2].y - dp[3].y) * t;
                lines.push(<line key={`v${t}`} x1={tx} y1={ty} x2={bx} y2={by} stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="5,5" />);
              }
              return lines;
            })()}

            {/* ── Corner handles ── */}
            {pts.map((p, i) => {
              const dp = toDisp(p.x, p.y);
              const cornerAngles = [
                { // TL — L-shape open to bottom-right
                  lines: [{ dx:16,dy:0 }, { dx:0,dy:16 }]
                },
                { // TR — open to bottom-left
                  lines: [{ dx:-16,dy:0 }, { dx:0,dy:16 }]
                },
                { // BR — open to top-left
                  lines: [{ dx:-16,dy:0 }, { dx:0,dy:-16 }]
                },
                { // BL — open to top-right
                  lines: [{ dx:16,dy:0 }, { dx:0,dy:-16 }]
                },
              ];
              const c = cornerAngles[i];
              return (
                <g key={i}
                  onMouseDown={e => onPointerDown(e, i)}
                  onTouchStart={e => onPointerDown(e, i)}
                  style={{ cursor:'grab' }}>
                  {/* Invisible large touch target */}
                  <circle cx={dp.x} cy={dp.y} r={HANDLE_R} fill="transparent" />
                  {/* L-shaped corner bracket */}
                  {c.lines.map((l, li) => (
                    <line key={li}
                      x1={dp.x} y1={dp.y}
                      x2={dp.x + l.dx} y2={dp.y + l.dy}
                      stroke="white" strokeWidth="3" strokeLinecap="round"
                    />
                  ))}
                  {/* Corner dot */}
                  <circle cx={dp.x} cy={dp.y} r={5} fill="white" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Hint */}
      <p style={{ textAlign:'center', color:'rgba(255,255,255,.4)', fontSize:12, padding:'10px', flexShrink:0 }}>
        Drag the corners to adjust the document boundary
      </p>
    </div>
  );
}

// ─── CameraCapture — Adobe Scan style ────────────────────────────────────────
function CameraCapture({ onCapture, onClose }) {
  const videoRef  = useRef();
  const [ready,   setReady]  = useState(false);
  const [flash,   setFlash]  = useState(false);
  const [error,   setError]  = useState('');
  const [torch,   setTorch]  = useState(false);
  const streamRef = useRef();

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 3840, min: 1280 },
        height: { ideal: 2160, min: 720 },
      },
      audio: false,
    }).then(s => {
      if (!mounted) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setReady(true);
    }).catch(e => setError('Camera: ' + e.message));
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v) return;
    // Flash animation
    setFlash(true);
    setTimeout(() => setFlash(false), 180);

    const c = document.createElement('canvas');
    c.width  = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.96));
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const newVal = !torch;
    track.applyConstraints({ advanced: [{ torch: newVal }] })
      .then(() => setTorch(newVal))
      .catch(() => {}); // torch not supported on this device
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:300, display:'flex', flexDirection:'column', userSelect:'none' }}>

      {/* Flash overlay */}
      {flash && <div style={{ position:'absolute', inset:0, background:'white', zIndex:10, opacity:.7, pointerEvents:'none' }} />}

      {/* Top controls */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, zIndex:5,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'env(safe-area-inset-top, 12px) 16px 12px',
        background:'linear-gradient(to bottom, rgba(0,0,0,.6) 0%, transparent 100%)',
      }}>
        <button onClick={onClose}
          style={{ width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', background:'none', border:'none', color:'white', fontSize:26, cursor:'pointer' }}>
          ×
        </button>
        <span style={{ color:'rgba(255,255,255,.8)', fontSize:13, fontFamily:'var(--font)', fontWeight:500 }}>
          Position document in frame
        </span>
        <button onClick={toggleTorch}
          style={{ width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center', background:'none', border:'none', color: torch ? '#FFD060' : 'white', fontSize:22, cursor:'pointer' }}>
          {torch ? '🔦' : '⚡'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:5, textAlign:'center' }}>
          <p style={{ color:'#f87', fontSize:14, padding:'20px' }}>{error}</p>
          <button onClick={onClose} style={{ color:'white', fontSize:14, background:'none', border:'1px solid white', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontFamily:'var(--font)' }}>Go back</button>
        </div>
      )}

      {/* Viewfinder — full screen */}
      <video
        ref={videoRef} autoPlay playsInline muted
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}
      />

      {/* Corner brackets overlay — document guide */}
      <div style={{ position:'absolute', inset:0, zIndex:4, pointerEvents:'none' }}>
        {/* Create four corner brackets at ~15% inset */}
        {[
          { top:'15%', left:'10%',  borderTop:'2px solid rgba(255,255,255,.7)', borderLeft:'2px solid rgba(255,255,255,.7)' },
          { top:'15%', right:'10%', borderTop:'2px solid rgba(255,255,255,.7)', borderRight:'2px solid rgba(255,255,255,.7)' },
          { bottom:'26%', left:'10%',  borderBottom:'2px solid rgba(255,255,255,.7)', borderLeft:'2px solid rgba(255,255,255,.7)' },
          { bottom:'26%', right:'10%', borderBottom:'2px solid rgba(255,255,255,.7)', borderRight:'2px solid rgba(255,255,255,.7)' },
        ].map((s, i) => (
          <div key={i} style={{ position:'absolute', width:28, height:28, ...s }} />
        ))}
      </div>

      {/* ── Bottom shutter area — large, thumb-reachable ── */}
      {ready && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, zIndex:5,
          paddingBottom:'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          paddingTop:20,
          background:'linear-gradient(to top, rgba(0,0,0,.75) 0%, transparent 100%)',
          display:'flex', flexDirection:'column', alignItems:'center', gap:16,
        }}>
          {/* Instruction */}
          <p style={{ color:'rgba(255,255,255,.55)', fontSize:12, fontFamily:'var(--font)' }}>
            Tap to capture
          </p>

          {/* Shutter button — CamScanner/Adobe Scan style */}
          <button
            onClick={shoot}
            onTouchStart={e => e.currentTarget.style.transform = 'scale(.92)'}
            onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)'; shoot(); }}
            style={{
              width: 76, height: 76,
              borderRadius: '50%',
              border: '4px solid white',
              background: 'transparent',
              cursor: 'pointer',
              position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              transition: 'transform .1s',
            }}>
            {/* Inner white disc */}
            <div style={{
              width: 58, height: 58, borderRadius: '50%',
              background: 'white',
            }} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page thumbnail strip ──────────────────────────────────────────────────────
function PageStrip({ pages, selected, onSelect, onDelete, onAdd }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8,
      padding:'8px 12px', background:'rgba(0,0,0,.85)',
      overflowX:'auto', WebkitOverflowScrolling:'touch',
      scrollbarWidth:'none', flexShrink:0,
    }}>
      {pages.map((p, i) => (
        <div key={p.id} onClick={() => onSelect(i)}
          style={{
            position:'relative', minWidth:48, width:48, height:64, borderRadius:5,
            border:`2.5px solid ${selected === i ? 'var(--accent)' : 'rgba(255,255,255,.2)'}`,
            overflow:'hidden', cursor:'pointer', flexShrink:0,
            transition:'border-color .15s',
          }}>
          <img src={p.processed || p.original} alt={`p${i+1}`}
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          <div style={{
            position:'absolute', bottom:0, left:0, right:0,
            background:'rgba(0,0,0,.6)', color:'white', fontSize:9,
            textAlign:'center', padding:'2px 0', fontFamily:'var(--font)',
          }}>{i + 1}</div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(i); }}
            style={{
              position:'absolute', top:2, right:2, width:18, height:18,
              borderRadius:'50%', background:'rgba(200,0,0,.8)', border:'none',
              color:'white', fontSize:11, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              WebkitTapHighlightColor:'transparent',
            }}>×</button>
        </div>
      ))}
      <button onClick={onAdd} style={{
        minWidth:48, width:48, height:64, borderRadius:5,
        border:'2px dashed rgba(255,255,255,.25)', background:'rgba(255,255,255,.06)',
        cursor:'pointer', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:2, flexShrink:0,
        WebkitTapHighlightColor:'transparent',
      }}>
        <span style={{ fontSize:20, color:'rgba(255,255,255,.6)', lineHeight:1 }}>＋</span>
        <span style={{ fontSize:9, color:'rgba(255,255,255,.4)', fontFamily:'var(--font)' }}>Add</span>
      </button>
    </div>
  );
}

// ─── Main ScannerPage ──────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { getAuthHeader }   = useAuth();
  const navigate            = useNavigate();
  const fileInputRef        = useRef();

  const [pages, setPages]           = useState([]);
  const [selected, setSelected]     = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [cropPage,  setCropPage]    = useState(null);  // page object to crop
  const [showFolder, setShowFolder] = useState(false);
  const [docName, setDocName]       = useState('');    // blank = sequential
  const [folder, setFolder]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')); } catch { return null; }
  });
  const [uploading, setUploading]   = useState(false);
  const [uploadDone, setUploadDone] = useState(null);
  const [error, setError]           = useState('');

  // ── Handle files from gallery ──
  function handleFiles(fileList) {
    Array.from(fileList)
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
          const id = uid();
          setPages(prev => [...prev, {
            id, original: e.target.result, processed: e.target.result,
            filter: 'original',
          }]);
          setSelected(prev => prev + 1);
        };
        reader.readAsDataURL(file);
      });
  }

  function handleCamera(dataUrl) {
    const id = uid();
    setPages(prev => [...prev, { id, original: dataUrl, processed: dataUrl, filter: 'original' }]);
    setSelected(prev => Math.max(0, prev));
    setShowCamera(false);
    // Auto-open crop editor on camera shot
    setCropPage({ id, original: dataUrl, processed: dataUrl, filter: 'original' });
  }

  function applyCrop(pageId, croppedDataUrl) {
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, processed: croppedDataUrl } : p
    ));
    setCropPage(null);
  }

  function deletePage(idx) {
    setPages(prev => prev.filter((_, i) => i !== idx));
    setSelected(s => Math.max(0, s >= idx ? s - 1 : s));
  }

  async function applyFilterToPage(idx, filterName) {
    const page = pages[idx];
    const img  = await loadImg(page.original);
    const c    = document.createElement('canvas');
    c.width    = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const result = applyFilter(c, filterName);
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: result, filter: filterName } : p));
  }

  async function rotateCurrentPage() {
    const page    = pages[selected];
    const rotated = await rotateCW(page.processed);
    setPages(prev => prev.map((p, i) => i === selected ? { ...p, processed: rotated } : p));
  }

  function movePage(from, dir) {
    const to = from + dir;
    if (to < 0 || to >= pages.length) return;
    setPages(prev => {
      const arr = [...prev];
      [arr[from], arr[to]] = [arr[to], arr[from]];
      return arr;
    });
    setSelected(to);
  }

  // ── Build PDF and upload ──
  async function buildAndUpload() {
    if (!pages.length) { setError('Add at least one page.'); return; }
    if (!folder)       { setShowFolder(true); return; }

    setUploading(true); setError('');
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
      const W = 595.28, H = 841.89;

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        const dataUrl = pages[i].processed || pages[i].original;
        const img     = await loadImg(dataUrl);
        const ratio   = Math.min(W / img.width, H / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        pdf.addImage(dataUrl, 'JPEG', (W-w)/2, (H-h)/2, w, h, undefined, 'FAST');
      }

      // Resolve name: user typed → AI (optional) → sequential
      let finalName = docName.trim();
      if (!finalName) {
        const firstBlob = dataUrlToBlob(pages[0].processed || pages[0].original);
        const firstFile = new File([firstBlob], 'scan.jpg', { type: 'image/jpeg' });
        const aiName    = await suggestName(firstFile, folder.path).catch(() => null);
        finalName = aiName ? sanitise(aiName) : getSequentialName(folder.path, '.pdf').replace('.pdf','');
      }
      finalName = finalName.replace(/\.pdf$/i, '') + '.pdf';

      const pdfBlob = pdf.output('blob');
      const form    = new FormData();
      form.append('document',   pdfBlob, finalName);
      form.append('folderPath', folder.path);  // ← path is source of truth
      form.append('customName', finalName);

      const h = await getAuthHeader();
      const { data } = await axios.post(`${BASE}/upload`, form, {
        headers: { Authorization: h, 'Content-Type': 'multipart/form-data' },
      });

      confirmUsed(folder.path);
      localStorage.setItem('dv_last_folder', JSON.stringify(folder));
      setUploadDone(data.file);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  }

  const activePage = pages[selected];

  // ── Crop editor overlay ──
  if (cropPage) {
    return (
      <CropEditor
        page={cropPage}
        onDone={croppedUrl => applyCrop(cropPage.id, croppedUrl)}
        onCancel={() => setCropPage(null)}
      />
    );
  }

  // ── Upload done screen ──
  if (uploadDone) {
    return (
      <div className="page" style={{ background:'var(--cream)' }}>
        <Navbar />
        <div style={{ maxWidth:460, margin:'0 auto', padding:'52px 20px', textAlign:'center' }}>
          <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
          <h2 style={{ marginBottom:8 }}>PDF saved!</h2>
          <p style={{ fontSize:14, color:'var(--ink-3)', fontFamily:'var(--mono)', marginBottom:4 }}>
            {uploadDone.name}
          </p>
          <p style={{ fontSize:12, color:'var(--ink-4)', marginBottom:28 }}>
            DocVault/{folder?.path}
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {uploadDone.viewLink && (
              <a href={uploadDone.viewLink} target="_blank" rel="noopener noreferrer"
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center',
                  padding:'14px', borderRadius:14,
                  background:'var(--accent)', color:'white',
                  textDecoration:'none', fontSize:15, fontWeight:600, fontFamily:'var(--font)',
                }}>
                Open in Drive ↗
              </a>
            )}
            <button onClick={() => { setPages([]); setUploadDone(null); setDocName(''); setSelected(0); }}
              style={{ padding:'14px', borderRadius:14, border:'1.5px solid var(--border)', background:'white', fontSize:15, cursor:'pointer', fontFamily:'var(--font)' }}>
              Scan another
            </button>
            <button onClick={() => navigate('/dashboard')}
              style={{ padding:'12px', borderRadius:14, border:'none', background:'none', fontSize:14, color:'var(--ink-3)', cursor:'pointer', fontFamily:'var(--font)' }}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100vh', background:'#111', display:'flex', flexDirection:'column', paddingBottom:'var(--bottom-bar-h)' }}>
      <Navbar darkBg />

      {/* ── Empty state ── */}
      {pages.length === 0 && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20, padding:'32px 24px' }}>
          <div style={{ fontSize:52, opacity:.25 }}>📄</div>
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:15, fontFamily:'var(--font)' }}>
            No pages yet
          </p>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
            <button
              onClick={() => setShowCamera(true)}
              style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'13px 22px', borderRadius:14,
                background:'var(--accent)', color:'white', border:'none',
                fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)',
                minHeight:52, WebkitTapHighlightColor:'transparent',
              }}>
              📷 Use Camera
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'13px 22px', borderRadius:14,
                background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.85)',
                border:'1.5px solid rgba(255,255,255,.2)',
                fontSize:15, cursor:'pointer', fontFamily:'var(--font)',
                minHeight:52, WebkitTapHighlightColor:'transparent',
              }}>
              🖼 Pick from Gallery
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
            style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
        </div>
      )}

      {/* ── Pages view ── */}
      {pages.length > 0 && activePage && (
        <>
          {/* Main preview */}
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'10px', minHeight:0 }}>
            <div style={{ position:'relative' }}>
              <img
                src={activePage.processed || activePage.original} alt="page"
                style={{
                  maxWidth:'100%',
                  maxHeight:'calc(100dvh - 320px)',
                  maxHeight:'calc(100vh - 320px)',
                  objectFit:'contain', borderRadius:6,
                  boxShadow:'0 6px 28px rgba(0,0,0,.6)',
                  display:'block',
                }}
              />
              {/* Crop button on preview */}
              <button
                onClick={() => setCropPage(activePage)}
                style={{
                  position:'absolute', top:8, right:8,
                  background:'rgba(0,0,0,.65)', border:'none', color:'white',
                  borderRadius:8, padding:'6px 10px', fontSize:12,
                  cursor:'pointer', fontFamily:'var(--font)',
                  display:'flex', alignItems:'center', gap:4,
                  WebkitTapHighlightColor:'transparent',
                }}>
                ✂️ Crop
              </button>
            </div>
          </div>

          {/* Filter + tool bar */}
          <div style={{
            display:'flex', gap:7, padding:'8px 12px', overflowX:'auto',
            background:'rgba(0,0,0,.5)', WebkitOverflowScrolling:'touch',
            scrollbarWidth:'none', flexShrink:0,
          }}>
            {[
              { id:'original', label:'Original' },
              { id:'enhance',  label:'Enhance' },
              { id:'bw',       label:'B&W' },
              { id:'magic',    label:'Magic' },
            ].map(f => (
              <button key={f.id} onClick={() => applyFilterToPage(selected, f.id)}
                style={{
                  padding:'7px 14px', borderRadius:99, border:'none', cursor:'pointer',
                  background: activePage.filter === f.id ? 'var(--accent)' : 'rgba(255,255,255,.1)',
                  color: activePage.filter === f.id ? 'white' : 'rgba(255,255,255,.75)',
                  fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap',
                  fontWeight: activePage.filter === f.id ? 600 : 400,
                  minHeight:34, WebkitTapHighlightColor:'transparent',
                }}>
                {f.label}
              </button>
            ))}
            <div style={{ width:1, background:'rgba(255,255,255,.12)', margin:'0 2px', flexShrink:0 }} />
            <button onClick={rotateCurrentPage}
              style={{ padding:'7px 13px', borderRadius:99, border:'none', cursor:'pointer', background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.75)', fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34, WebkitTapHighlightColor:'transparent' }}>
              ↻ Rotate
            </button>
            <button onClick={() => movePage(selected, -1)} disabled={selected === 0}
              style={{ padding:'7px 12px', borderRadius:99, border:'none', cursor:'pointer', background:'rgba(255,255,255,.1)', color: selected===0 ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.75)', fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34, WebkitTapHighlightColor:'transparent' }}>
              ← Move
            </button>
            <button onClick={() => movePage(selected, 1)} disabled={selected === pages.length - 1}
              style={{ padding:'7px 12px', borderRadius:99, border:'none', cursor:'pointer', background:'rgba(255,255,255,.1)', color: selected===pages.length-1 ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.75)', fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', minHeight:34, WebkitTapHighlightColor:'transparent' }}>
              Move →
            </button>
          </div>

          {/* Page strip */}
          <PageStrip pages={pages} selected={selected} onSelect={setSelected}
            onDelete={deletePage} onAdd={() => setShowCamera(true)} />

          {/* Bottom action bar */}
          <div style={{
            background:'white', padding:'12px 14px',
            borderTop:'1px solid var(--border-soft)', flexShrink:0,
          }}>
            {/* Doc name */}
            <div style={{ display:'flex', gap:8, marginBottom:9, alignItems:'center' }}>
              <input
                value={docName}
                onChange={e => setDocName(e.target.value)}
                placeholder="Document name (auto if blank)…"
                style={{
                  flex:1, padding:'11px 13px', border:'1.5px solid var(--border)',
                  borderRadius:10, fontFamily:'var(--font)', fontSize:16,
                  outline:'none', background:'var(--paper)', color:'var(--ink)',
                  minHeight:46,
                }}
              />
              <button onClick={() => fileInputRef.current?.click()}
                style={{
                  width:46, height:46, borderRadius:10,
                  border:'1px solid var(--border)', background:'var(--paper)',
                  cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center',
                  WebkitTapHighlightColor:'transparent', flexShrink:0,
                }}>＋</button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
                style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
            </div>

            {/* Folder selector */}
            <button onClick={() => setShowFolder(true)} style={{
              width:'100%', textAlign:'left', padding:'10px 13px', marginBottom:9,
              border:`1.5px solid ${folder ? 'var(--accent-light)' : '#e8a040'}`,
              background: folder ? 'var(--accent-bg)' : '#fff8ee',
              borderRadius:10, cursor:'pointer',
              display:'flex', alignItems:'center', gap:8, fontFamily:'var(--font)',
              minHeight:46, WebkitTapHighlightColor:'transparent',
            }}>
              <span style={{ fontSize:16 }}>📂</span>
              <span style={{ fontSize:13, color: folder ? 'var(--accent)' : '#9a6010', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {folder ? `DocVault/${folder.path}` : 'Tap to choose folder'}
              </span>
              <span style={{ fontSize:14, color:'var(--ink-4)', flexShrink:0 }}>›</span>
            </button>

            {error && <p style={{ fontSize:12, color:'var(--red)', marginBottom:8 }}>⚠ {error}</p>}

            <button onClick={buildAndUpload} disabled={uploading} style={{
              width:'100%', padding:'15px', borderRadius:14,
              background: uploading ? 'var(--accent-light)' : 'var(--accent)',
              color:'white', border:'none', fontSize:15, fontWeight:700,
              cursor: uploading ? 'default' : 'pointer', fontFamily:'var(--font)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              minHeight:54, WebkitTapHighlightColor:'transparent',
            }}>
              {uploading
                ? <><span className="spin" style={{ display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} /> Building PDF…</>
                : `Save ${pages.length} page${pages.length !== 1 ? 's' : ''} as PDF →`
              }
            </button>
          </div>
        </>
      )}

      {showCamera && (
        <CameraCapture onCapture={handleCamera} onClose={() => setShowCamera(false)} />
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
