/* eslint-disable no-unused-vars */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Navbar from '../../components/Navbar';
import FolderSheet from '../../components/FolderSheet';
import { ShareButton } from '../../components/ShareButton';
import axios from 'axios';
import { BASE } from '../../utils/api';
import { getSequentialName, confirmUsed, sanitise } from '../../utils/naming';
import { suggestName } from '../../utils/aiNaming';
import { perspectiveCrop } from './cropUtils';

// ─── tiny helpers ─────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
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

// ─── Image filters ────────────────────────────────────────────────────────────
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
      d[i]   = Math.min(255,Math.max(0,(d[i]  -128)*1.5+148));
      d[i+1] = Math.min(255,Math.max(0,(d[i+1]-128)*1.5+148));
      d[i+2] = Math.min(255,Math.max(0,(d[i+2]-128)*1.5+148));
    }
  } else if (filter === 'magic') {
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      g = g > 190 ? 255 : g < 60 ? 0 : ((g-60)/130)*255;
      d[i] = d[i+1] = d[i+2] = Math.min(255, g);
    }
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.98);
}

async function rotateCW(dataUrl) {
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = H; c.height = W;
  const ctx = c.getContext('2d');
  ctx.translate(H/2, W/2);
  ctx.rotate(Math.PI/2);
  ctx.drawImage(img, -W/2, -H/2);
  return c.toDataURL('image/jpeg', 0.98);
}

// ─── Build PDF ────────────────────────────────────────────────────────────────
async function buildPDF(pages) {
  const { jsPDF } = await import('jspdf');
  const PW = 595.28, PH = 841.89, M = 20;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4', compress:true });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const dataUrl = pages[i].processed || pages[i].original;
    const img     = await loadImg(dataUrl);
    const IW = img.naturalWidth || img.width;
    const IH = img.naturalHeight || img.height;
    const scale = Math.min((PW-M*2)/IW, (PH-M*2)/IH);
    const dw = IW*scale, dh = IH*scale;
    const fmt = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    pdf.addImage(dataUrl, fmt, (PW-dw)/2, (PH-dh)/2, dw, dh, undefined, 'NONE');
  }
  return pdf.output('blob');
}

// ─── CropEditor ───────────────────────────────────────────────────────────────
//
// Handle layout (indices):
//   Corners:  0=TL  1=TR  2=BR  3=BL
//   Edges:    4=Top  5=Right  6=Bottom  7=Left
//
// Dragging an edge midpoint moves the two adjacent corners symmetrically
// along the perpendicular axis only, keeping the other axis stable.
// This gives you the "push a whole side" feel of pro scanner apps.
//
// All dragging state is in a ref — zero re-renders during drag = 60fps.
//
function CropEditor({ page, onDone, onCancel }) {
  const [imgSize,  setImgSize]  = useState(null);
  const [dispSize, setDispSize] = useState(null);
  // pts stored in a ref for 60fps drag, replicated to state only on pointerUp
  const ptsRef    = useRef(null);
  const [pts,     setPts]       = useState(null);
  const dragRef   = useRef(null); // { handleIndex, startX, startY }
  const svgRef    = useRef(null);
  const [applying, setApplying] = useState(false);

  // Load image and compute display size + default corners
  useEffect(() => {
    const src = page.original;
    loadImg(src).then(img => {
      const IW = img.naturalWidth  || img.width;
      const IH = img.naturalHeight || img.height;
      setImgSize({ w: IW, h: IH });
      const vw = window.innerWidth;
      const vh = window.innerHeight - 160;
      const scale = Math.min((vw - 24) / IW, vh / IH, 1);
      setDispSize({ w: Math.round(IW*scale), h: Math.round(IH*scale) });
      const M = 0.08;
      const initial = [
        { x: IW*M,       y: IH*M       }, // TL
        { x: IW*(1-M),   y: IH*M       }, // TR
        { x: IW*(1-M),   y: IH*(1-M)   }, // BR
        { x: IW*M,       y: IH*(1-M)   }, // BL
      ];
      ptsRef.current = initial;
      setPts(initial);
    }).catch(() => onDone(page.processed || page.original));
  }, [page, onDone]);

  // Convert between image-space and display-space
  const toD = useCallback((ix, iy) => {
    if (!imgSize || !dispSize) return { x:0, y:0 };
    return { x: (ix/imgSize.w)*dispSize.w, y: (iy/imgSize.h)*dispSize.h };
  }, [imgSize, dispSize]);

  const toI = useCallback((dx, dy) => {
    if (!imgSize || !dispSize) return { x:0, y:0 };
    return {
      x: Math.max(0,Math.min(imgSize.w, (dx/dispSize.w)*imgSize.w)),
      y: Math.max(0,Math.min(imgSize.h, (dy/dispSize.h)*imgSize.h)),
    };
  }, [imgSize, dispSize]);

  // Get SVG-relative pointer position (works for mouse + touch)
  function svgPos(e) {
    const svg = svgRef.current;
    if (!svg) return { x:0, y:0 };
    const rect = svg.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: Math.max(0, Math.min(dispSize.w, src.clientX - rect.left)),
      y: Math.max(0, Math.min(dispSize.h, src.clientY - rect.top)),
    };
  }

  function onPointerDown(e, handleIdx) {
    e.preventDefault();
    e.stopPropagation();
    const pos = svgPos(e);
    dragRef.current = { handleIdx, lastX: pos.x, lastY: pos.y };
  }

  // Core drag logic — runs at pointer-move rate, no setState
  function onPointerMove(e) {
    if (!dragRef.current || !ptsRef.current) return;
    e.preventDefault();
    const { handleIdx } = dragRef.current;
    const pos = svgPos(e);
    const newPts = [...ptsRef.current];

    if (handleIdx < 4) {
      // Corner drag — move freely
      newPts[handleIdx] = toI(pos.x, pos.y);
    } else {
      // Edge drag — push two adjacent corners along perpendicular axis
      //   4=Top(TL+TR), 5=Right(TR+BR), 6=Bottom(BR+BL), 7=Left(BL+TL)
      const edgeCorners = [[0,1],[1,2],[2,3],[3,0]];
      const [cA, cB] = edgeCorners[handleIdx - 4];
      const iPt = toI(pos.x, pos.y);
      if (handleIdx === 4 || handleIdx === 6) {
        // Top/Bottom edge: move both corners' Y only
        const midY = (newPts[cA].y + newPts[cB].y) / 2;
        const dy   = iPt.y - midY;
        newPts[cA] = { ...newPts[cA], y: newPts[cA].y + dy };
        newPts[cB] = { ...newPts[cB], y: newPts[cB].y + dy };
      } else {
        // Left/Right edge: move both corners' X only
        const midX = (newPts[cA].x + newPts[cB].x) / 2;
        const dx   = iPt.x - midX;
        newPts[cA] = { ...newPts[cA], x: newPts[cA].x + dx };
        newPts[cB] = { ...newPts[cB], x: newPts[cB].x + dx };
      }
    }

    // Update ref synchronously (60fps, no re-render)
    ptsRef.current = newPts;

    // Update SVG handles directly via DOM for 60fps (bypass React)
    updateSVGHandles(newPts);
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Commit to React state only on release
    if (ptsRef.current) setPts([...ptsRef.current]);
  }

  // Direct DOM manipulation of SVG elements for butter-smooth 60fps
  function updateSVGHandles(p) {
    const svg = svgRef.current;
    if (!svg || !imgSize || !dispSize) return;
    const corners = p.map(pt => toD(pt.x, pt.y));

    // Edge midpoints
    const mids = [
      { x:(corners[0].x+corners[1].x)/2, y:(corners[0].y+corners[1].y)/2 }, // Top
      { x:(corners[1].x+corners[2].x)/2, y:(corners[1].y+corners[2].y)/2 }, // Right
      { x:(corners[2].x+corners[3].x)/2, y:(corners[2].y+corners[3].y)/2 }, // Bottom
      { x:(corners[3].x+corners[0].x)/2, y:(corners[3].y+corners[0].y)/2 }, // Left
    ];

    // Update polygon
    const poly = svg.querySelector('#crop-poly');
    if (poly) poly.setAttribute('points', corners.map(c=>`${c.x},${c.y}`).join(' '));
    const border = svg.querySelector('#crop-border');
    if (border) border.setAttribute('points', corners.map(c=>`${c.x},${c.y}`).join(' '));

    // Update mask
    const maskPoly = svg.querySelector('#mask-poly');
    if (maskPoly) maskPoly.setAttribute('points', corners.map(c=>`${c.x},${c.y}`).join(' '));

    // Update grid lines
    for (let ti = 0; ti < 2; ti++) {
      const t = [1/3, 2/3][ti];
      const hLine = svg.querySelector(`#hline-${ti}`);
      if (hLine) {
        hLine.setAttribute('x1', corners[0].x+(corners[3].x-corners[0].x)*t);
        hLine.setAttribute('y1', corners[0].y+(corners[3].y-corners[0].y)*t);
        hLine.setAttribute('x2', corners[1].x+(corners[2].x-corners[1].x)*t);
        hLine.setAttribute('y2', corners[1].y+(corners[2].y-corners[1].y)*t);
      }
      const vLine = svg.querySelector(`#vline-${ti}`);
      if (vLine) {
        vLine.setAttribute('x1', corners[0].x+(corners[1].x-corners[0].x)*t);
        vLine.setAttribute('y1', corners[0].y+(corners[1].y-corners[0].y)*t);
        vLine.setAttribute('x2', corners[3].x+(corners[2].x-corners[3].x)*t);
        vLine.setAttribute('y2', corners[3].y+(corners[2].y-corners[3].y)*t);
      }
    }

    // Update corner handles
    for (let i = 0; i < 4; i++) {
      const g = svg.querySelector(`#corner-${i}`);
      if (!g) continue;
      const c = corners[i];
      const arms = [[[1,0],[0,1]],[[-1,0],[0,1]],[[-1,0],[0,-1]],[[1,0],[0,-1]]][i];
      const L = 22;
      const lines = g.querySelectorAll('line');
      const dot   = g.querySelector('circle');
      // shadow lines (0,1) white lines (2,3)
      for (let li = 0; li < 2; li++) {
        [lines[li], lines[li+2]].forEach(ln => {
          if (!ln) return;
          ln.setAttribute('x1', c.x); ln.setAttribute('y1', c.y);
          ln.setAttribute('x2', c.x + arms[li][0]*L);
          ln.setAttribute('y2', c.y + arms[li][1]*L);
        });
      }
      if (dot) { dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); }
    }

    // Update edge handles
    for (let i = 0; i < 4; i++) {
      const g = svg.querySelector(`#edge-${i}`);
      if (!g) continue;
      const m = mids[i];
      const hit = g.querySelector('.edge-hit');
      const bar = g.querySelector('.edge-bar');
      const dot = g.querySelector('.edge-dot');
      if (hit) { hit.setAttribute('cx', m.x); hit.setAttribute('cy', m.y); }
      if (dot) { dot.setAttribute('cx', m.x); dot.setAttribute('cy', m.y); }
      // Bar orientation: horizontal for top/bottom, vertical for left/right
      if (bar) {
        if (i === 0 || i === 2) {
          bar.setAttribute('x1', m.x-18); bar.setAttribute('y1', m.y);
          bar.setAttribute('x2', m.x+18); bar.setAttribute('y2', m.y);
        } else {
          bar.setAttribute('x1', m.x); bar.setAttribute('y1', m.y-18);
          bar.setAttribute('x2', m.x); bar.setAttribute('y2', m.y+18);
        }
      }
    }
  }

  async function apply() {
    setApplying(true);
    try {
      const cropped = await perspectiveCrop(page.original, ptsRef.current);
      if (page.filter && page.filter !== 'original') {
        onDone(await applyFilterToDataUrl(cropped, page.filter));
      } else {
        onDone(cropped);
      }
    } catch (err) {
      console.error('Crop error:', err);
      onDone(page.processed || page.original);
    }
    setApplying(false);
  }

  if (!pts || !imgSize || !dispSize) {
    return (
      <div style={{ position:'fixed', inset:0, background:'#111', zIndex:400,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div className="spin" style={{ width:36, height:36, borderRadius:'50%',
          border:'2px solid rgba(255,255,255,.15)', borderTopColor:'white' }} />
      </div>
    );
  }

  const corners = pts.map(p => toD(p.x, p.y));
  const mids = [
    { x:(corners[0].x+corners[1].x)/2, y:(corners[0].y+corners[1].y)/2 },
    { x:(corners[1].x+corners[2].x)/2, y:(corners[1].y+corners[2].y)/2 },
    { x:(corners[2].x+corners[3].x)/2, y:(corners[2].y+corners[3].y)/2 },
    { x:(corners[3].x+corners[0].x)/2, y:(corners[3].y+corners[0].y)/2 },
  ];
  const polyStr = corners.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ position:'fixed', inset:0, background:'#0a0a0a', zIndex:400,
      display:'flex', flexDirection:'column', touchAction:'none', userSelect:'none',
      WebkitUserSelect:'none' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 16px', paddingTop:'max(12px,env(safe-area-inset-top,12px))',
        flexShrink:0, background:'rgba(0,0,0,.7)' }}>
        <button onClick={onCancel} style={{ background:'none', border:'none',
          color:'rgba(255,255,255,.75)', fontSize:15, cursor:'pointer',
          padding:'8px 12px', minWidth:64, minHeight:44, fontFamily:'var(--font)',
          WebkitTapHighlightColor:'transparent' }}>
          Cancel
        </button>
        <span style={{ color:'white', fontSize:15, fontWeight:700, letterSpacing:'-.01em' }}>
          Adjust Crop
        </span>
        <button onClick={apply} disabled={applying} style={{
          background: applying ? 'rgba(204,120,92,.5)' : 'var(--accent)',
          border:'none', color:'white', fontSize:15, fontWeight:700,
          cursor: applying ? 'default' : 'pointer',
          padding:'9px 22px', borderRadius:99, minHeight:44, minWidth:64,
          fontFamily:'var(--font)', WebkitTapHighlightColor:'transparent',
          transition:'background .15s',
        }}>
          {applying
            ? <span className="spin" style={{ display:'inline-block', width:16, height:16,
                border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} />
            : 'Done'
          }
        </button>
      </div>

      {/* Canvas area */}
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        overflow:'hidden', padding:'12px' }}>
        <div style={{ position:'relative', width:dispSize.w, height:dispSize.h,
          boxShadow:'0 8px 40px rgba(0,0,0,.8)', borderRadius:4 }}>

          <img src={page.processed || page.original} alt="crop"
            style={{ width:dispSize.w, height:dispSize.h, display:'block',
              pointerEvents:'none', userSelect:'none', borderRadius:4 }} />

          <svg ref={svgRef}
            width={dispSize.w} height={dispSize.h}
            style={{ position:'absolute', top:0, left:0,
              touchAction:'none', overflow:'visible' }}
            onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
            onTouchMove={onPointerMove} onTouchEnd={onPointerUp} onTouchCancel={onPointerUp}
          >
            {/* Dark mask outside crop */}
            <defs>
              <mask id="crop-mask">
                <rect width="100%" height="100%" fill="white" />
                <polygon id="mask-poly" points={polyStr} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,.58)" mask="url(#crop-mask)" />

            {/* Crop border */}
            <polygon id="crop-border" points={polyStr}
              fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5" />

            {/* Inner polygon (clear region visual) */}
            <polygon id="crop-poly" points={polyStr}
              fill="none" stroke="none" />

            {/* Rule-of-thirds grid */}
            {[0,1].map(ti => {
              const t = [1/3,2/3][ti];
              const tl={x:corners[0].x+(corners[3].x-corners[0].x)*t,y:corners[0].y+(corners[3].y-corners[0].y)*t};
              const tr={x:corners[1].x+(corners[2].x-corners[1].x)*t,y:corners[1].y+(corners[2].y-corners[1].y)*t};
              const tl2={x:corners[0].x+(corners[1].x-corners[0].x)*t,y:corners[0].y+(corners[1].y-corners[0].y)*t};
              const bl2={x:corners[3].x+(corners[2].x-corners[3].x)*t,y:corners[3].y+(corners[2].y-corners[3].y)*t};
              return (
                <g key={ti}>
                  <line id={`hline-${ti}`} x1={tl.x} y1={tl.y} x2={tr.x} y2={tr.y}
                    stroke="rgba(255,255,255,.35)" strokeWidth="0.8" strokeDasharray="5,4" />
                  <line id={`vline-${ti}`} x1={tl2.x} y1={tl2.y} x2={bl2.x} y2={bl2.y}
                    stroke="rgba(255,255,255,.35)" strokeWidth="0.8" strokeDasharray="5,4" />
                </g>
              );
            })}

            {/* ── Edge midpoint handles ── */}
            {mids.map((m, i) => {
              const isHoriz = i === 0 || i === 2;
              return (
                <g key={`edge-${i}`} id={`edge-${i}`}
                  onMouseDown={e => onPointerDown(e, i+4)}
                  onTouchStart={e => onPointerDown(e, i+4)}
                  style={{ cursor: isHoriz ? 'ns-resize' : 'ew-resize', touchAction:'none' }}>
                  {/* Large invisible hit target */}
                  <circle className="edge-hit" cx={m.x} cy={m.y} r={24} fill="transparent" />
                  {/* Shadow bar */}
                  <line className="edge-bar-shadow"
                    x1={isHoriz?m.x-18:m.x} y1={isHoriz?m.y:m.y-18}
                    x2={isHoriz?m.x+18:m.x} y2={isHoriz?m.y:m.y+18}
                    stroke="rgba(0,0,0,.5)" strokeWidth="5" strokeLinecap="round" />
                  {/* White bar */}
                  <line className="edge-bar"
                    x1={isHoriz?m.x-18:m.x} y1={isHoriz?m.y:m.y-18}
                    x2={isHoriz?m.x+18:m.x} y2={isHoriz?m.y:m.y+18}
                    stroke="white" strokeWidth="3" strokeLinecap="round" />
                  {/* Centre dot */}
                  <circle className="edge-dot" cx={m.x} cy={m.y} r={4}
                    fill="white" stroke="rgba(0,0,0,.35)" strokeWidth="1.5" />
                </g>
              );
            })}

            {/* ── Corner handles ── */}
            {corners.map((c, i) => {
              const arms = [[[1,0],[0,1]],[[-1,0],[0,1]],[[-1,0],[0,-1]],[[1,0],[0,-1]]][i];
              const L = 22;
              return (
                <g key={i} id={`corner-${i}`}
                  onMouseDown={e => onPointerDown(e, i)}
                  onTouchStart={e => onPointerDown(e, i)}
                  style={{ cursor:'grab', touchAction:'none' }}>
                  {/* Hit target */}
                  <circle cx={c.x} cy={c.y} r={28} fill="transparent" />
                  {/* Shadow arms */}
                  {arms.map(([dx,dy], ai) => (
                    <line key={`cs${ai}`}
                      x1={c.x} y1={c.y} x2={c.x+dx*L} y2={c.y+dy*L}
                      stroke="rgba(0,0,0,.55)" strokeWidth="5" strokeLinecap="round" />
                  ))}
                  {/* White arms */}
                  {arms.map(([dx,dy], ai) => (
                    <line key={`cw${ai}`}
                      x1={c.x} y1={c.y} x2={c.x+dx*L} y2={c.y+dy*L}
                      stroke="white" strokeWidth="3" strokeLinecap="round" />
                  ))}
                  {/* Corner dot */}
                  <circle cx={c.x} cy={c.y} r={6}
                    fill="white" stroke="rgba(0,0,0,.3)" strokeWidth="1.5" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Hint */}
      <p style={{ textAlign:'center', color:'rgba(255,255,255,.35)', fontSize:12,
        padding:'10px 16px', paddingBottom:'max(16px,env(safe-area-inset-bottom,16px))',
        flexShrink:0, fontFamily:'var(--font)' }}>
        Drag corners or edge bars to adjust
      </p>
    </div>
  );
}

// ─── Camera Capture ───────────────────────────────────────────────────────────
function CameraCapture({ onCapture, onClose }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const [torch, setTorch] = useState(false);

  const attachStream = useCallback((video, stream) => {
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    const onMeta = () => {
      video.play().catch(() => {});
      if (mountedRef.current) setReady(true);
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('canplay', () => {
      if (mountedRef.current) setReady(true);
    }, { once: true });
  }, []);

  const videoCallbackRef = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current) attachStream(el, streamRef.current);
  }, [attachStream]);

  useEffect(() => {
    mountedRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not supported. Use Chrome or Safari.');
      return;
    }
    const constraints = [
      { video:{ facingMode:{ exact:'environment' }, width:{ ideal:3840 }, height:{ ideal:2160 } }, audio:false },
      { video:{ facingMode:'environment', width:{ ideal:1920 }, height:{ ideal:1080 } }, audio:false },
      { video:{ facingMode:'user', width:{ ideal:1280 }, height:{ ideal:720 } }, audio:false },
      { video:true, audio:false },
    ];
    async function start() {
      for (const c of constraints) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(c);
          if (!mountedRef.current) { stream.getTracks().forEach(t=>t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) attachStream(videoRef.current, stream);
          return;
        } catch (e) {
          if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            if (mountedRef.current) setError('Camera permission denied. Allow it in browser settings.');
            return;
          }
        }
      }
      if (mountedRef.current) setError('No camera found on this device.');
    }
    start();
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach(t=>t.stop());
      streamRef.current = null;
    };
  }, [attachStream]);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.98));
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    track.applyConstraints({ advanced:[{ torch:next }] }).then(()=>setTorch(next)).catch(()=>{});
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, background:'#000',
      display:'flex', flexDirection:'column', userSelect:'none', touchAction:'none' }}>
      {flash && <div style={{ position:'absolute', inset:0, background:'white',
        opacity:.75, zIndex:20, pointerEvents:'none' }} />}
      <video ref={videoCallbackRef} autoPlay playsInline muted
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
      <div style={{
        position:'absolute', top:0, left:0, right:0, zIndex:10,
        background:'linear-gradient(180deg,rgba(0,0,0,.7) 0%,transparent 100%)',
        padding:'max(env(safe-area-inset-top,12px),12px) 12px 28px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <button onClick={onClose} style={{
          width:48, height:48, borderRadius:'50%', background:'rgba(0,0,0,.4)',
          border:'none', color:'white', fontSize:24, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          WebkitTapHighlightColor:'transparent',
        }}>✕</button>
        <span style={{ color:'rgba(255,255,255,.85)', fontSize:13,
          fontFamily:'var(--font)', fontWeight:500 }}>
          {error ? '' : ready ? 'Position document in frame' : 'Starting camera…'}
        </span>
        <button onClick={toggleTorch} style={{
          width:48, height:48, borderRadius:'50%',
          background: torch ? 'rgba(255,210,60,.25)' : 'rgba(0,0,0,.4)',
          border: torch ? '1.5px solid rgba(255,210,60,.7)' : 'none',
          color: torch ? '#FFD03C' : 'white', fontSize:20, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          WebkitTapHighlightColor:'transparent',
        }}>⚡</button>
      </div>
      {error && (
        <div style={{ position:'absolute', inset:0, zIndex:15, display:'flex',
          flexDirection:'column', alignItems:'center', justifyContent:'center',
          padding:'32px', textAlign:'center', background:'rgba(0,0,0,.88)' }}>
          <div style={{ fontSize:52, marginBottom:16 }}>📷</div>
          <p style={{ color:'white', fontSize:15, marginBottom:24,
            fontFamily:'var(--font)', lineHeight:1.6 }}>{error}</p>
          <button onClick={onClose} style={{
            padding:'13px 28px', borderRadius:99, background:'white',
            color:'#222', border:'none', fontSize:15, cursor:'pointer',
            fontFamily:'var(--font)', fontWeight:600,
          }}>Go Back</button>
        </div>
      )}
      {!error && (
        <div style={{ position:'absolute', inset:0, zIndex:8, pointerEvents:'none' }}>
          {[
            { top:'13%',   left:'7%',   borderTop:'3px solid rgba(255,255,255,.8)', borderLeft:'3px solid rgba(255,255,255,.8)' },
            { top:'13%',   right:'7%',  borderTop:'3px solid rgba(255,255,255,.8)', borderRight:'3px solid rgba(255,255,255,.8)' },
            { bottom:'23%',left:'7%',   borderBottom:'3px solid rgba(255,255,255,.8)', borderLeft:'3px solid rgba(255,255,255,.8)' },
            { bottom:'23%',right:'7%',  borderBottom:'3px solid rgba(255,255,255,.8)', borderRight:'3px solid rgba(255,255,255,.8)' },
          ].map((s,i) => <div key={i} style={{ position:'absolute', width:34, height:34, ...s }} />)}
        </div>
      )}
      {!ready && !error && (
        <div style={{ position:'absolute', inset:0, zIndex:14, display:'flex',
          alignItems:'center', justifyContent:'center' }}>
          <div style={{ textAlign:'center' }}>
            <div className="spin" style={{ width:36, height:36, margin:'0 auto 12px',
              border:'2px solid rgba(255,255,255,.15)', borderTopColor:'white', borderRadius:'50%' }} />
            <p style={{ color:'rgba(255,255,255,.5)', fontSize:13, fontFamily:'var(--font)' }}>
              Starting camera…
            </p>
          </div>
        </div>
      )}
      {ready && !error && (
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, zIndex:10,
          paddingBottom:'max(env(safe-area-inset-bottom,0px),28px)', paddingTop:20,
          background:'linear-gradient(0deg,rgba(0,0,0,.72) 0%,transparent 100%)',
          display:'flex', flexDirection:'column', alignItems:'center', gap:12,
        }}>
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:11,
            fontFamily:'var(--font)', letterSpacing:'.08em', textTransform:'uppercase' }}>
            Tap to capture
          </p>
          <button
            onPointerDown={e => { e.currentTarget.style.transform='scale(.89)'; }}
            onPointerUp={e => { e.currentTarget.style.transform='scale(1)'; shoot(); }}
            onPointerCancel={e => { e.currentTarget.style.transform='scale(1)'; }}
            style={{
              width:82, height:82, borderRadius:'50%',
              border:'4px solid rgba(255,255,255,.92)',
              background:'transparent', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              WebkitTapHighlightColor:'transparent',
              transition:'transform .1s cubic-bezier(.25,.46,.45,.94)',
            }}>
            <div style={{ width:64, height:64, borderRadius:'50%', background:'white',
              boxShadow:'0 2px 12px rgba(0,0,0,.35)' }} />
          </button>
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
          <div onClick={() => onSelect(i)} style={{
            width:50, height:66, borderRadius:6, overflow:'hidden', cursor:'pointer',
            border:`2.5px solid ${selected===i?'var(--accent)':'rgba(255,255,255,.18)'}`,
            transition:'border-color .15s',
          }}>
            <img src={p.processed||p.original} alt={`page ${i+1}`}
              style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            <div style={{
              position:'absolute', bottom:0, left:0, right:0,
              background:'rgba(0,0,0,.65)', color:'white', fontSize:9,
              textAlign:'center', padding:'2px 0', fontFamily:'var(--font)',
            }}>{i+1}</div>
          </div>
          <button onClick={() => onCrop(i)} style={{
            position:'absolute', top:-6, left:-6, width:22, height:22,
            borderRadius:'50%', background:'rgba(30,30,30,.9)',
            border:'1.5px solid rgba(255,255,255,.3)', color:'white',
            fontSize:11, cursor:'pointer', display:'flex',
            alignItems:'center', justifyContent:'center',
            WebkitTapHighlightColor:'transparent', zIndex:2,
          }}>✂</button>
          <button onClick={() => onDelete(i)} style={{
            position:'absolute', top:-6, right:-6, width:22, height:22,
            borderRadius:'50%', background:'rgba(180,30,30,.9)',
            border:'1.5px solid rgba(255,255,255,.2)', color:'white',
            fontSize:13, cursor:'pointer', display:'flex',
            alignItems:'center', justifyContent:'center',
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

// ─── Main ScannerPage ─────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { getAuthHeader } = useAuth();
  const navigate          = useNavigate();
  const fileInputRef      = useRef(null);

  const [pages,        setPages]        = useState([]);
  const [selected,     setSelected]     = useState(0);
  const [showCamera,   setShowCamera]   = useState(false);
  const [cropIndex,    setCropIndex]    = useState(null);
  // cropPending: true after camera capture until user does crop or skips
  const [cropPending,  setCropPending]  = useState(false);
  const [showFolder,   setShowFolder]   = useState(false);
  const [docName,      setDocName]      = useState('');
  const [outputFmt,    setOutputFmt]    = useState('pdf');
  const [folder,     setFolder]     = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')); } catch { return null; }
  });
  const [uploading,  setUploading]  = useState(false);
  const [uploadDone, setUploadDone] = useState(null);
  const [error,      setError]      = useState('');

  const addPage = useCallback((original) => {
    const p = { id: uid(), original, processed: original, filter: 'original' };
    setPages(prev => [...prev, p]);
    return p;
  }, []);

  const handleFiles = useCallback((fileList) => {
    Array.from(fileList)
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .forEach(file => {
        const reader = new FileReader();
        reader.onload = e => addPage(e.target.result);
        reader.readAsDataURL(file);
      });
  }, [addPage]);

  const handleCamera = useCallback((dataUrl) => {
    const id = uid();
    setShowCamera(false);
    setCropPending(true); // block saving until crop is done or skipped
    setPages(prev => {
      const newPage = { id, original: dataUrl, processed: dataUrl, filter: 'original' };
      const next = [...prev, newPage];
      const idx = next.length - 1;
      setTimeout(() => setCropIndex(idx), 30);
      return next;
    });
  }, []);

  const applyCrop = useCallback((idx, croppedUrl) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: croppedUrl } : p));
    setCropIndex(null);
    setCropPending(false); // crop done — allow saving
  }, []);

  const deletePage = useCallback((idx) => {
    setPages(prev => prev.filter((_, i) => i !== idx));
    setSelected(s => Math.max(0, s > idx ? s-1 : Math.min(s, pages.length-2)));
    setCropIndex(c => c === idx ? null : c);
  }, [pages.length]);

  const applyFilter = useCallback(async (idx, filter) => {
    const page = pages[idx];
    // ALWAYS apply to page.original — never to page.processed.
    // Applying enhance to an already-enhanced image doubles the effect.
    // Clicking "Original" must restore the true original, not re-encode the filtered version.
    const result = await applyFilterToDataUrl(page.original, filter);
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: result, filter } : p));
  }, [pages]);

  const rotate = useCallback(async (idx) => {
    const page   = pages[idx];
    const result = await rotateCW(page.processed);
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, processed: result } : p));
  }, [pages]);

  const movePage = useCallback((from, dir) => {
    const to = from + dir;
    if (to < 0 || to >= pages.length) return;
    setPages(prev => {
      const a = [...prev]; [a[from], a[to]] = [a[to], a[from]]; return a;
    });
    setSelected(to);
  }, [pages.length]);

  async function saveAndUpload() {
    if (!pages.length)    { setError('Add at least one page.'); return; }
    if (cropPending)      { setError('Please crop or skip the current page first.'); return; }
    if (!folder)          { setShowFolder(true); return; }
    setUploading(true); setError('');
    try {
      let blob, ext, mimeType;
      if (outputFmt === 'pdf' || pages.length > 1) {
        blob = await buildPDF(pages); ext = '.pdf'; mimeType = 'application/pdf';
      } else {
        const dataUrl = pages[0].processed || pages[0].original;
        const q = outputFmt === 'jpg' ? 'image/jpeg' : 'image/png';
        const canvas = document.createElement('canvas');
        const img = await loadImg(dataUrl);
        canvas.width  = img.naturalWidth  || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        blob = await new Promise(r => canvas.toBlob(r, q, 0.98));
        ext = outputFmt === 'jpg' ? '.jpg' : '.png'; mimeType = q;
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
        headers:{ Authorization:h, 'Content-Type':'multipart/form-data' },
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
        onCancel={() => {
          // If this was from a camera capture (cropPending), ask to skip or go back
          if (cropPending) {
            // Show a native confirm — if they cancel, just close crop but keep pending
            // Actually: cancel = keep cropPending so save is still blocked
            // User must either: re-open crop, or use the "Skip crop" button in bottom bar
          }
          setCropIndex(null);
          // Note: cropPending stays true so Save is blocked — user must tap Skip Crop
        }}
      />
    );
  }

  if (uploadDone) {
    return (
      <div className="page" style={{ background:'var(--cream)' }}>
        <Navbar />
        <div style={{ maxWidth:440, margin:'0 auto', padding:'48px 20px', textAlign:'center' }}>
          <div style={{ fontSize:60, marginBottom:16 }}>✅</div>
          <h2 style={{ marginBottom:8 }}>Saved to Drive!</h2>
          <p style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--ink-3)', marginBottom:4,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {uploadDone.fileName || uploadDone.name}
          </p>
          <p style={{ fontSize:12, color:'var(--ink-4)', marginBottom:28 }}>
            DocVault/{folder?.path}
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {/* Share the saved file directly from success screen */}
            {uploadDone.id && (
              <ShareButton
                file={uploadDone}
                getAuthHeader={getAuthHeader}
                variant="full"
              />
            )}
            {uploadDone.viewLink && (
              <a href={uploadDone.viewLink} target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  padding:'13px', borderRadius:14,
                  border:'1.5px solid var(--border)', background:'white',
                  color:'var(--ink-2)', textDecoration:'none', fontSize:14,
                  fontFamily:'var(--font)', fontWeight:500 }}>
                Open in Drive ↗
              </a>
            )}
            <button onClick={() => { setPages([]); setUploadDone(null); setDocName(''); setSelected(0); }}
              style={{ padding:'13px', borderRadius:14, border:'1.5px solid var(--border)',
                background:'white', fontSize:15, cursor:'pointer', fontFamily:'var(--font)' }}>
              Scan another
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
    <div style={{ height:'100vh', background:'#111',
      display:'flex', flexDirection:'column', overflow:'hidden',
      paddingBottom:'var(--bottom-bar-h)' }}>
      <Navbar darkBg />

      {pages.length === 0 && (
        <div style={{ flex:1, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', gap:20, padding:'32px 24px' }}>
          <div style={{ fontSize:56, opacity:.2 }}>📄</div>
          <p style={{ color:'rgba(255,255,255,.4)', fontSize:15, fontFamily:'var(--font)' }}>No pages yet</p>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
            <button onClick={() => setShowCamera(true)} style={{
              padding:'14px 24px', borderRadius:14, background:'var(--accent)', color:'white',
              border:'none', fontSize:15, fontWeight:600, cursor:'pointer',
              fontFamily:'var(--font)', minHeight:52, display:'flex', alignItems:'center', gap:8,
              WebkitTapHighlightColor:'transparent',
            }}>📷 Use Camera</button>
            <button onClick={() => fileInputRef.current?.click()} style={{
              padding:'14px 24px', borderRadius:14,
              background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.85)',
              border:'1.5px solid rgba(255,255,255,.18)', fontSize:15, cursor:'pointer',
              fontFamily:'var(--font)', minHeight:52, display:'flex', alignItems:'center', gap:8,
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
            <img src={activePage.processed||activePage.original} alt="current page"
              style={{
                maxWidth:'100%', maxHeight:'calc(100vh - 310px)',
                objectFit:'contain', borderRadius:7, boxShadow:'0 6px 32px rgba(0,0,0,.65)', display:'block',
              }} />
            <button onClick={() => setCropIndex(selected)} style={{
              position:'absolute', top:18, right:18, background:'rgba(0,0,0,.7)',
              backdropFilter:'blur(6px)', border:'none', color:'white', borderRadius:99,
              padding:'7px 14px', fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font)',
              WebkitTapHighlightColor:'transparent',
            }}>✂️ Crop</button>
          </div>

          <div style={{ display:'flex', gap:7, padding:'7px 12px', overflowX:'auto',
            WebkitOverflowScrolling:'touch', scrollbarWidth:'none',
            background:'rgba(0,0,0,.55)', flexShrink:0 }}>
            {[
              { id:'original', label:'Original', icon:'📷' },
              { id:'enhance',  label:'Enhance',  icon:'✨' },
              { id:'bw',       label:'B&W',       icon:'⬛' },
              { id:'magic',    label:'Magic',     icon:'🪄' },
            ].map(f => (
              <button key={f.id} onClick={() => applyFilter(selected, f.id)} style={{
                padding:'7px 13px', borderRadius:99, border:'none', cursor:'pointer',
                background: activePage.filter===f.id ? 'var(--accent)' : 'rgba(255,255,255,.1)',
                color: activePage.filter===f.id ? 'white' : 'rgba(255,255,255,.75)',
                fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap',
                fontWeight: activePage.filter===f.id ? 600 : 400, minHeight:34,
                WebkitTapHighlightColor:'transparent',
                display:'flex', alignItems:'center', gap:5,
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

          <PageStrip pages={pages} selected={selected}
            onSelect={setSelected} onCrop={setCropIndex}
            onDelete={deletePage} onAdd={() => setShowCamera(true)} />

          <div style={{ background:'white', padding:'11px 13px',
            borderTop:'1px solid var(--border-soft)', flexShrink:0 }}>
            <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'center' }}>
              <input value={docName} onChange={e => setDocName(e.target.value)}
                placeholder="Name (auto if blank)…"
                style={{ flex:1, padding:'10px 12px', border:'1.5px solid var(--border)',
                  borderRadius:10, fontFamily:'var(--font)', fontSize:16, outline:'none',
                  background:'var(--paper)', color:'var(--ink)', minHeight:44 }} />
              <button onClick={() => fileInputRef.current?.click()} style={{
                width:44, height:44, borderRadius:10, border:'1px solid var(--border)',
                background:'var(--paper)', cursor:'pointer', fontSize:18,
                display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0, WebkitTapHighlightColor:'transparent',
              }}>＋</button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
                style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
            </div>
            <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'stretch' }}>
              <div style={{ display:'flex', gap:3, background:'var(--sand)', borderRadius:9, padding:3, flexShrink:0 }}>
                {['pdf','jpg','png'].map(fmt => (
                  <button key={fmt} onClick={() => setOutputFmt(fmt)} style={{
                    padding:'5px 10px', borderRadius:7,
                    background: outputFmt===fmt ? 'white' : 'transparent',
                    border:'none', cursor:'pointer', fontSize:12,
                    fontWeight: outputFmt===fmt ? 700 : 400,
                    color: outputFmt===fmt ? 'var(--ink)' : 'var(--ink-3)',
                    fontFamily:'var(--font)', minHeight:34, textTransform:'uppercase',
                    boxShadow: outputFmt===fmt ? '0 1px 4px rgba(0,0,0,.12)' : 'none',
                    WebkitTapHighlightColor:'transparent',
                    transition:'background .15s, box-shadow .15s',
                  }}>{fmt}</button>
                ))}
              </div>
              <button onClick={() => setShowFolder(true)} style={{
                flex:1, textAlign:'left', padding:'7px 12px',
                border:`1.5px solid ${folder?'var(--accent-light)':'#e8a040'}`,
                background: folder ? 'var(--accent-bg)' : '#fff8ee',
                borderRadius:9, cursor:'pointer', fontFamily:'var(--font)',
                display:'flex', alignItems:'center', gap:7, minHeight:44,
                WebkitTapHighlightColor:'transparent', overflow:'hidden',
              }}>
                <span style={{ fontSize:15, flexShrink:0 }}>📂</span>
                <span style={{ fontSize:12, color: folder?'var(--accent)':'#9a6010',
                  flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {folder ? `DocVault/${folder.path}` : 'Choose folder'}
                </span>
                <span style={{ fontSize:13, color:'var(--ink-4)', flexShrink:0 }}>›</span>
              </button>
            </div>
            {pages.length > 1 && outputFmt !== 'pdf' && (
              <p style={{ fontSize:11, color:'var(--amber)', marginBottom:6 }}>
                ⚠️ Multiple pages will always be saved as PDF
              </p>
            )}
            {/* Crop pending — must crop or skip before saving */}
            {cropPending && (
              <div style={{ background:'var(--amber-bg)', border:'1px solid #f0cc82',
                borderRadius:10, padding:'10px 12px', marginBottom:9,
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                <div>
                  <p style={{ fontSize:13, color:'var(--amber)', fontWeight:600, marginBottom:2 }}>
                    ✂️ Crop pending
                  </p>
                  <p style={{ fontSize:11, color:'var(--amber)', opacity:.85 }}>
                    Tap the crop button or skip to save as-is.
                  </p>
                </div>
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <button
                    onClick={() => { const idx = pages.length - 1; setCropIndex(idx); }}
                    style={{ padding:'7px 12px', borderRadius:8, background:'var(--accent)',
                      color:'white', border:'none', fontSize:12, fontWeight:600,
                      cursor:'pointer', fontFamily:'var(--font)', minHeight:34 }}>
                    ✂️ Crop
                  </button>
                  <button
                    onClick={() => setCropPending(false)}
                    style={{ padding:'7px 12px', borderRadius:8, background:'white',
                      color:'var(--ink-3)', border:'1px solid var(--border)',
                      fontSize:12, cursor:'pointer', fontFamily:'var(--font)', minHeight:34 }}>
                    Skip
                  </button>
                </div>
              </div>
            )}
            {error && <p style={{ fontSize:12, color:'var(--red)', marginBottom:6 }}>⚠ {error}</p>}
            <button onClick={saveAndUpload} disabled={uploading} style={{
              width:'100%', padding:'14px', borderRadius:13,
              background: uploading ? 'var(--accent-light)' : 'var(--accent)',
              color:'white', border:'none', fontSize:15, fontWeight:700,
              cursor: uploading ? 'default' : 'pointer', fontFamily:'var(--font)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              minHeight:52, WebkitTapHighlightColor:'transparent',
              transition:'background .15s',
            }}>
              {uploading
                ? <><span className="spin" style={{ display:'inline-block', width:16, height:16,
                    border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} />
                    Building {outputFmt.toUpperCase()}…</>
                : `Save ${pages.length}p as ${outputFmt.toUpperCase()} →`
              }
            </button>
          </div>
        </>
      )}

      {showCamera && (
        <CameraCapture onCapture={handleCamera} onClose={() => setShowCamera(false)} />
      )}
      {showFolder && (
        <FolderSheet getAuthHeader={getAuthHeader} lastUsedFolderId={folder?.id}
          onSelect={f => { setFolder(f); setShowFolder(false); }}
          onClose={() => setShowFolder(false)} />
      )}
    </div>
  );
}
