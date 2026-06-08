/* eslint-disable react-hooks/exhaustive-deps */
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
import { applyFilterToDataUrl, buildPDF, loadImg } from './imageProcessing';

// ─── helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(b64);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function rotateCW(dataUrl) {
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = H; c.height = W;
  const ctx = c.getContext('2d');
  ctx.translate(H/2, W/2); ctx.rotate(Math.PI/2);
  ctx.drawImage(img, -W/2, -H/2);
  return c.toDataURL('image/jpeg', 0.98);
}

// ─── CropEditor ───────────────────────────────────────────────────────────────
function CropEditor({ page, onDone, onCancel }) {
  const [imgSize,  setImgSize]  = useState(null);
  const [dispSize, setDispSize] = useState(null);
  const ptsRef    = useRef(null);
  const [pts,     setPts]       = useState(null);
  const dragRef   = useRef(null);
  const svgRef    = useRef(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    loadImg(page.original).then(img => {
      const IW = img.naturalWidth || img.width;
      const IH = img.naturalHeight || img.height;
      setImgSize({ w:IW, h:IH });
      const vw = window.innerWidth;
      const vh = window.innerHeight - 160;
      const scale = Math.min((vw-24)/IW, vh/IH, 1);
      setDispSize({ w:Math.round(IW*scale), h:Math.round(IH*scale) });
      const M = 0.08;
      const init = [
        {x:IW*M,     y:IH*M     },
        {x:IW*(1-M), y:IH*M     },
        {x:IW*(1-M), y:IH*(1-M)},
        {x:IW*M,     y:IH*(1-M)},
      ];
      ptsRef.current = init;
      setPts(init);
    }).catch(() => onDone(page.processed || page.original));
  }, [page, onDone]);

  const toD = useCallback((ix, iy) => {
    if (!imgSize || !dispSize) return {x:0,y:0};
    return { x:(ix/imgSize.w)*dispSize.w, y:(iy/imgSize.h)*dispSize.h };
  }, [imgSize, dispSize]);

  const toI = useCallback((dx, dy) => {
    if (!imgSize || !dispSize) return {x:0,y:0};
    return {
      x: Math.max(0,Math.min(imgSize.w,(dx/dispSize.w)*imgSize.w)),
      y: Math.max(0,Math.min(imgSize.h,(dy/dispSize.h)*imgSize.h)),
    };
  }, [imgSize, dispSize]);

  function svgPos(e) {
    const svg = svgRef.current;
    if (!svg) return {x:0,y:0};
    const rect = svg.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: Math.max(0,Math.min(dispSize.w, src.clientX-rect.left)),
      y: Math.max(0,Math.min(dispSize.h, src.clientY-rect.top)),
    };
  }

  function onPointerDown(e, idx) { e.preventDefault(); e.stopPropagation(); dragRef.current = {idx}; }

  function onPointerMove(e) {
    if (!dragRef.current || !ptsRef.current) return;
    e.preventDefault();
    const {idx} = dragRef.current;
    const pos = svgPos(e);
    const np  = [...ptsRef.current];
    if (idx < 4) {
      np[idx] = toI(pos.x, pos.y);
    } else {
      const edgePairs = [[0,1],[1,2],[2,3],[3,0]];
      const [cA,cB] = edgePairs[idx-4];
      const ip = toI(pos.x, pos.y);
      if (idx===4||idx===6) {
        const dy = ip.y - (np[cA].y+np[cB].y)/2;
        np[cA] = {...np[cA], y:np[cA].y+dy};
        np[cB] = {...np[cB], y:np[cB].y+dy};
      } else {
        const dx = ip.x - (np[cA].x+np[cB].x)/2;
        np[cA] = {...np[cA], x:np[cA].x+dx};
        np[cB] = {...np[cB], x:np[cB].x+dx};
      }
    }
    ptsRef.current = np;
    updateSVG(np);
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (ptsRef.current) setPts([...ptsRef.current]);
  }

  function updateSVG(p) {
    const svg = svgRef.current;
    if (!svg || !imgSize || !dispSize) return;
    const c   = p.map(pt => toD(pt.x, pt.y));
    const mids = [
      {x:(c[0].x+c[1].x)/2,y:(c[0].y+c[1].y)/2},
      {x:(c[1].x+c[2].x)/2,y:(c[1].y+c[2].y)/2},
      {x:(c[2].x+c[3].x)/2,y:(c[2].y+c[3].y)/2},
      {x:(c[3].x+c[0].x)/2,y:(c[3].y+c[0].y)/2},
    ];
    const poly = c.map(pt=>`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    svg.querySelector('#crop-border')?.setAttribute('points', poly);
    svg.querySelector('#mask-poly')?.setAttribute('points', poly);
    [0,1].forEach(ti => {
      const t = [1/3,2/3][ti];
      const h = svg.querySelector(`#hline-${ti}`);
      const v = svg.querySelector(`#vline-${ti}`);
      if (h) {
        h.setAttribute('x1', c[0].x+(c[3].x-c[0].x)*t); h.setAttribute('y1', c[0].y+(c[3].y-c[0].y)*t);
        h.setAttribute('x2', c[1].x+(c[2].x-c[1].x)*t); h.setAttribute('y2', c[1].y+(c[2].y-c[1].y)*t);
      }
      if (v) {
        v.setAttribute('x1', c[0].x+(c[1].x-c[0].x)*t); v.setAttribute('y1', c[0].y+(c[1].y-c[0].y)*t);
        v.setAttribute('x2', c[3].x+(c[2].x-c[3].x)*t); v.setAttribute('y2', c[3].y+(c[2].y-c[3].y)*t);
      }
    });
    c.forEach((pt,i) => {
      const g = svg.querySelector(`#corner-${i}`);
      if (!g) return;
      const arms = [[[1,0],[0,1]],[[-1,0],[0,1]],[[-1,0],[0,-1]],[[1,0],[0,-1]]][i];
      const L = 22;
      const lines = g.querySelectorAll('line');
      const dot   = g.querySelector('circle');
      for (let li=0;li<2;li++) {
        [lines[li],lines[li+2]].forEach(ln => {
          if (!ln) return;
          ln.setAttribute('x1',pt.x); ln.setAttribute('y1',pt.y);
          ln.setAttribute('x2',pt.x+arms[li][0]*L); ln.setAttribute('y2',pt.y+arms[li][1]*L);
        });
      }
      if (dot) { dot.setAttribute('cx',pt.x); dot.setAttribute('cy',pt.y); }
    });
    mids.forEach((m,i) => {
      const g = svg.querySelector(`#edge-${i}`);
      if (!g) return;
      const isH = i===0||i===2;
      g.querySelector('.edge-hit')?.setAttribute('cx',m.x);
      g.querySelector('.edge-hit')?.setAttribute('cy',m.y);
      g.querySelector('.edge-dot')?.setAttribute('cx',m.x);
      g.querySelector('.edge-dot')?.setAttribute('cy',m.y);
      const bar = g.querySelector('.edge-bar');
      if (bar) {
        bar.setAttribute('x1',isH?m.x-18:m.x); bar.setAttribute('y1',isH?m.y:m.y-18);
        bar.setAttribute('x2',isH?m.x+18:m.x); bar.setAttribute('y2',isH?m.y:m.y+18);
      }
    });
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
    } catch { onDone(page.processed || page.original); }
    setApplying(false);
  }

  if (!pts || !imgSize || !dispSize) return (
    <div style={{position:'fixed',inset:0,background:'#111',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div className="spin" style={{width:36,height:36,borderRadius:'50%',border:'2px solid rgba(255,255,255,.15)',borderTopColor:'white'}}/>
    </div>
  );

  const corners = pts.map(p => toD(p.x,p.y));
  const mids = [
    {x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2},
    {x:(corners[1].x+corners[2].x)/2,y:(corners[1].y+corners[2].y)/2},
    {x:(corners[2].x+corners[3].x)/2,y:(corners[2].y+corners[3].y)/2},
    {x:(corners[3].x+corners[0].x)/2,y:(corners[3].y+corners[0].y)/2},
  ];
  const polyStr = corners.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <div style={{position:'fixed',inset:0,background:'#0a0a0a',zIndex:400,
      display:'flex',flexDirection:'column',touchAction:'none',userSelect:'none',WebkitUserSelect:'none'}}>
      {/* Top bar — kept very compact so image gets maximum space */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'6px 12px',paddingTop:'max(6px,env(safe-area-inset-top,6px))',
        flexShrink:0,background:'rgba(0,0,0,.8)',minHeight:44}}>
        <button onClick={onCancel} style={{background:'none',border:'none',color:'rgba(255,255,255,.7)',
          fontSize:13,cursor:'pointer',padding:'6px 10px',minWidth:60,minHeight:36,fontFamily:'var(--font)',
          WebkitTapHighlightColor:'transparent'}}>Cancel</button>
        <span style={{color:'rgba(255,255,255,.6)',fontSize:11,fontWeight:500,letterSpacing:'.04em'}}>
          DRAG TO ADJUST
        </span>
        <button onClick={apply} disabled={applying} style={{
          background:applying?'rgba(204,120,92,.5)':'var(--accent)',border:'none',
          color:'white',fontSize:13,fontWeight:700,cursor:applying?'default':'pointer',
          padding:'7px 18px',borderRadius:99,minHeight:36,minWidth:60,fontFamily:'var(--font)',
          WebkitTapHighlightColor:'transparent'}}>
          {applying
            ? <span className="spin" style={{display:'inline-block',width:14,height:14,
                border:'2px solid rgba(255,255,255,.3)',borderTopColor:'white',borderRadius:'50%'}}/>
            : 'Done'}
        </button>
      </div>

      {/* Image + SVG — flex:1 gives this all remaining space */}
      <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:6}}>
        <div style={{position:'relative',width:dispSize.w,height:dispSize.h}}>
          <img src={page.processed||page.original} alt="crop"
            style={{width:dispSize.w,height:dispSize.h,display:'block',pointerEvents:'none',userSelect:'none'}}/>
          <svg ref={svgRef} width={dispSize.w} height={dispSize.h}
            style={{position:'absolute',top:0,left:0,touchAction:'none',overflow:'visible'}}
            onMouseMove={onPointerMove} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
            onTouchMove={onPointerMove} onTouchEnd={onPointerUp} onTouchCancel={onPointerUp}>
            <defs>
              <mask id="crop-mask">
                <rect width="100%" height="100%" fill="white"/>
                <polygon id="mask-poly" points={polyStr} fill="black"/>
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,.58)" mask="url(#crop-mask)"/>
            <polygon id="crop-border" points={polyStr} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="1.5"/>
            {[0,1].map(ti => {
              const t=[1/3,2/3][ti];
              const a={x:corners[0].x+(corners[3].x-corners[0].x)*t,y:corners[0].y+(corners[3].y-corners[0].y)*t};
              const b={x:corners[1].x+(corners[2].x-corners[1].x)*t,y:corners[1].y+(corners[2].y-corners[1].y)*t};
              const c2={x:corners[0].x+(corners[1].x-corners[0].x)*t,y:corners[0].y+(corners[1].y-corners[0].y)*t};
              const d2={x:corners[3].x+(corners[2].x-corners[3].x)*t,y:corners[3].y+(corners[2].y-corners[3].y)*t};
              return (<g key={ti}>
                <line id={`hline-${ti}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,.35)" strokeWidth=".8" strokeDasharray="5,4"/>
                <line id={`vline-${ti}`} x1={c2.x} y1={c2.y} x2={d2.x} y2={d2.y} stroke="rgba(255,255,255,.35)" strokeWidth=".8" strokeDasharray="5,4"/>
              </g>);
            })}
            {/* Edge handles */}
            {mids.map((m,i) => {
              const isH = i===0||i===2;
              return (
                <g key={`e${i}`} id={`edge-${i}`} onMouseDown={e=>onPointerDown(e,i+4)} onTouchStart={e=>onPointerDown(e,i+4)} style={{cursor:isH?'ns-resize':'ew-resize',touchAction:'none'}}>
                  <circle className="edge-hit" cx={m.x} cy={m.y} r={24} fill="transparent"/>
                  <line stroke="rgba(0,0,0,.5)" strokeWidth="5" strokeLinecap="round"
                    x1={isH?m.x-18:m.x} y1={isH?m.y:m.y-18} x2={isH?m.x+18:m.x} y2={isH?m.y:m.y+18}/>
                  <line className="edge-bar" stroke="white" strokeWidth="3" strokeLinecap="round"
                    x1={isH?m.x-18:m.x} y1={isH?m.y:m.y-18} x2={isH?m.x+18:m.x} y2={isH?m.y:m.y+18}/>
                  <circle className="edge-dot" cx={m.x} cy={m.y} r={4} fill="white" stroke="rgba(0,0,0,.3)" strokeWidth="1.5"/>
                </g>
              );
            })}
            {/* Corner handles */}
            {corners.map((c,i) => {
              const arms = [[[1,0],[0,1]],[[-1,0],[0,1]],[[-1,0],[0,-1]],[[1,0],[0,-1]]][i];
              const L = 22;
              return (
                <g key={i} id={`corner-${i}`} onMouseDown={e=>onPointerDown(e,i)} onTouchStart={e=>onPointerDown(e,i)} style={{cursor:'grab',touchAction:'none'}}>
                  <circle cx={c.x} cy={c.y} r={28} fill="transparent"/>
                  {arms.map(([dx,dy],ai) => <line key={`cs${ai}`} x1={c.x} y1={c.y} x2={c.x+dx*L} y2={c.y+dy*L} stroke="rgba(0,0,0,.55)" strokeWidth="5" strokeLinecap="round"/>)}
                  {arms.map(([dx,dy],ai) => <line key={`cw${ai}`} x1={c.x} y1={c.y} x2={c.x+dx*L} y2={c.y+dy*L} stroke="white" strokeWidth="3" strokeLinecap="round"/>)}
                  <circle cx={c.x} cy={c.y} r={6} fill="white" stroke="rgba(0,0,0,.3)" strokeWidth="1.5"/>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <p style={{textAlign:'center',color:'rgba(255,255,255,.25)',fontSize:10,
        padding:'4px 12px',paddingBottom:'max(6px,env(safe-area-inset-bottom,6px))',
        flexShrink:0,fontFamily:'var(--font)'}}>
        Corners ↔ Edges to adjust
      </p>
    </div>
  );
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function CameraCapture({ onCapture, onClose }) {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const mountedRef = useRef(true);
  const [ready,  setReady]  = useState(false);
  const [flash,  setFlash]  = useState(false);
  const [error,  setError]  = useState('');
  const [torch,  setTorch]  = useState(false);

  const attachStream = useCallback((video, stream) => {
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {});
      if (mountedRef.current) setReady(true);
    }, {once:true});
    video.addEventListener('canplay', () => {
      if (mountedRef.current) setReady(true);
    }, {once:true});
  }, []);

  const videoCallbackRef = useCallback(el => {
    videoRef.current = el;
    if (el && streamRef.current) attachStream(el, streamRef.current);
  }, [attachStream]);

  useEffect(() => {
    mountedRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera not supported in this browser.'); return; }
    const constraints = [
      {video:{facingMode:{exact:'environment'},width:{ideal:3840},height:{ideal:2160}},audio:false},
      {video:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}},audio:false},
      {video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false},
      {video:true,audio:false},
    ];
    async function start() {
      for (const c of constraints) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(c);
          if (!mountedRef.current) { stream.getTracks().forEach(t=>t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) attachStream(videoRef.current, stream);
          return;
        } catch(e) {
          if (e.name==='NotAllowedError'||e.name==='PermissionDeniedError') {
            if (mountedRef.current) setError('Camera permission denied. Allow it in your browser settings.');
            return;
          }
        }
      }
      if (mountedRef.current) setError('No camera found on this device.');
    }
    start();
    return () => { mountedRef.current=false; streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null; };
  }, [attachStream]);

  function shoot() {
    const v = videoRef.current;
    if (!v||!v.videoWidth||!v.videoHeight) return;
    setFlash(true); setTimeout(()=>setFlash(false),180);
    const c = document.createElement('canvas');
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext('2d').drawImage(v,0,0);
    onCapture(c.toDataURL('image/jpeg',0.98));
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    track.applyConstraints({advanced:[{torch:next}]}).then(()=>setTorch(next)).catch(()=>{});
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:'#000',display:'flex',flexDirection:'column',userSelect:'none',touchAction:'none'}}>
      {flash && <div style={{position:'absolute',inset:0,background:'white',opacity:.75,zIndex:20,pointerEvents:'none'}}/>}
      <video ref={videoCallbackRef} autoPlay playsInline muted
        style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/>
      {/* Top gradient */}
      <div style={{position:'absolute',top:0,left:0,right:0,zIndex:10,
        background:'linear-gradient(180deg,rgba(0,0,0,.7) 0%,transparent 100%)',
        padding:'max(env(safe-area-inset-top,12px),12px) 12px 28px',
        display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <button onClick={onClose} style={{width:48,height:48,borderRadius:'50%',background:'rgba(0,0,0,.4)',
          border:'none',color:'white',fontSize:24,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
          WebkitTapHighlightColor:'transparent'}}>✕</button>
        <span style={{color:'rgba(255,255,255,.85)',fontSize:13,fontFamily:'var(--font)',fontWeight:500}}>
          {error?'':ready?'Position document in frame':'Starting camera…'}
        </span>
        <button onClick={toggleTorch} style={{width:48,height:48,borderRadius:'50%',
          background:torch?'rgba(255,210,60,.25)':'rgba(0,0,0,.4)',
          border:torch?'1.5px solid rgba(255,210,60,.7)':'none',
          color:torch?'#FFD03C':'white',fontSize:20,cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',WebkitTapHighlightColor:'transparent'}}>⚡</button>
      </div>
      {error && (
        <div style={{position:'absolute',inset:0,zIndex:15,display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',padding:'32px',textAlign:'center',background:'rgba(0,0,0,.88)'}}>
          <div style={{fontSize:52,marginBottom:16}}>📷</div>
          <p style={{color:'white',fontSize:15,marginBottom:24,fontFamily:'var(--font)',lineHeight:1.6}}>{error}</p>
          <button onClick={onClose} style={{padding:'13px 28px',borderRadius:99,background:'white',
            color:'#222',border:'none',fontSize:15,cursor:'pointer',fontFamily:'var(--font)',fontWeight:600}}>Go Back</button>
        </div>
      )}
      {/* Corner guides */}
      {!error && (
        <div style={{position:'absolute',inset:0,zIndex:8,pointerEvents:'none'}}>
          {[
            {top:'13%',left:'7%',borderTop:'3px solid rgba(255,255,255,.8)',borderLeft:'3px solid rgba(255,255,255,.8)'},
            {top:'13%',right:'7%',borderTop:'3px solid rgba(255,255,255,.8)',borderRight:'3px solid rgba(255,255,255,.8)'},
            {bottom:'23%',left:'7%',borderBottom:'3px solid rgba(255,255,255,.8)',borderLeft:'3px solid rgba(255,255,255,.8)'},
            {bottom:'23%',right:'7%',borderBottom:'3px solid rgba(255,255,255,.8)',borderRight:'3px solid rgba(255,255,255,.8)'},
          ].map((s,i)=><div key={i} style={{position:'absolute',width:34,height:34,...s}}/>)}
        </div>
      )}
      {!ready && !error && (
        <div style={{position:'absolute',inset:0,zIndex:14,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{textAlign:'center'}}>
            <div className="spin" style={{width:36,height:36,margin:'0 auto 12px',
              border:'2px solid rgba(255,255,255,.15)',borderTopColor:'white',borderRadius:'50%'}}/>
            <p style={{color:'rgba(255,255,255,.5)',fontSize:13,fontFamily:'var(--font)'}}>Starting camera…</p>
          </div>
        </div>
      )}
      {/* Shutter — bottom, large, thumb-reachable */}
      {ready && !error && (
        <div style={{position:'absolute',bottom:0,left:0,right:0,zIndex:10,
          paddingBottom:'max(env(safe-area-inset-bottom,0px),28px)',paddingTop:20,
          background:'linear-gradient(0deg,rgba(0,0,0,.72) 0%,transparent 100%)',
          display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <p style={{color:'rgba(255,255,255,.45)',fontSize:11,fontFamily:'var(--font)',letterSpacing:'.08em',textTransform:'uppercase'}}>
            Tap to capture
          </p>
          <button
            onPointerDown={e=>{e.currentTarget.style.transform='scale(.89)';}}
            onPointerUp={e=>{e.currentTarget.style.transform='scale(1)';shoot();}}
            onPointerCancel={e=>{e.currentTarget.style.transform='scale(1)';}}
            style={{width:82,height:82,borderRadius:'50%',border:'4px solid rgba(255,255,255,.92)',
              background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              WebkitTapHighlightColor:'transparent',transition:'transform .1s'}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:'white',boxShadow:'0 2px 12px rgba(0,0,0,.35)'}}/>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page Strip ───────────────────────────────────────────────────────────────
// Fixed height, visible page numbers, clear crop/delete buttons
function PageStrip({ pages, selected, onSelect, onCrop, onDelete, onAdd }) {
  return (
    <div style={{
      height:96, minHeight:96,
      display:'flex', alignItems:'center', gap:8,
      padding:'0 12px',
      background:'rgba(10,10,10,.95)',
      overflowX:'auto', overflowY:'visible',
      WebkitOverflowScrolling:'touch', scrollbarWidth:'none',
      flexShrink:0,
      borderTop:'1px solid rgba(255,255,255,.08)',
    }}>
      {pages.map((p, i) => (
        <div key={p.id} style={{position:'relative',flexShrink:0,marginTop:4}}>
          {/* Thumbnail */}
          <div onClick={() => onSelect(i)} style={{
            width:54, height:72, borderRadius:6, overflow:'hidden', cursor:'pointer',
            border:`2.5px solid ${selected===i ? 'var(--accent)' : 'rgba(255,255,255,.2)'}`,
            transition:'border-color .15s', position:'relative',
          }}>
            <img src={p.processed||p.original} alt={`p${i+1}`}
              style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            {/* Page number badge — white pill, always visible */}
            <div style={{
              position:'absolute', bottom:3, left:'50%', transform:'translateX(-50%)',
              background:'rgba(0,0,0,.75)', color:'white',
              fontSize:10, fontWeight:700, fontFamily:'var(--font)',
              padding:'1px 6px', borderRadius:99, lineHeight:'16px',
              whiteSpace:'nowrap',
            }}>{i+1}</div>
          </div>
          {/* Crop — top left */}
          <button onClick={()=>onCrop(i)} style={{
            position:'absolute',top:-7,left:-7,width:24,height:24,
            borderRadius:'50%',background:'rgba(20,20,20,.95)',
            border:'1.5px solid rgba(255,255,255,.4)',color:'white',
            fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
            WebkitTapHighlightColor:'transparent',zIndex:2,
          }}>✂</button>
          {/* Delete — top right */}
          <button onClick={()=>onDelete(i)} style={{
            position:'absolute',top:-7,right:-7,width:24,height:24,
            borderRadius:'50%',background:'rgba(180,30,30,.95)',
            border:'1.5px solid rgba(255,255,255,.25)',color:'white',
            fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
            WebkitTapHighlightColor:'transparent',zIndex:2,lineHeight:1,
          }}>×</button>
        </div>
      ))}
      {/* Add page */}
      <button onClick={onAdd} style={{
        minWidth:54,width:54,height:72,borderRadius:6,flexShrink:0,marginTop:4,
        border:'2px dashed rgba(255,255,255,.25)',background:'rgba(255,255,255,.04)',
        cursor:'pointer',display:'flex',flexDirection:'column',
        alignItems:'center',justifyContent:'center',gap:2,
        WebkitTapHighlightColor:'transparent',
      }}>
        <span style={{fontSize:22,color:'rgba(255,255,255,.5)',lineHeight:1}}>＋</span>
        <span style={{fontSize:9,color:'rgba(255,255,255,.35)',fontFamily:'var(--font)'}}>Add</span>
      </button>
    </div>
  );
}

// ─── Main ScannerPage ─────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { getAuthHeader } = useAuth();
  const navigate          = useNavigate();
  const fileInputRef      = useRef(null);

  const [pages,       setPages]       = useState([]);
  const [selected,    setSelected]    = useState(0);
  const [showCamera,  setShowCamera]  = useState(false);
  const [cropIndex,   setCropIndex]   = useState(null);
  const [cropPending, setCropPending] = useState(false);
  const [showFolder,  setShowFolder]  = useState(false);
  const [docName,     setDocName]     = useState('');
  const [outputFmt,   setOutputFmt]   = useState('pdf');
  const [folder, setFolder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')); } catch { return null; }
  });
  const [uploading,   setUploading]   = useState(false);
  const [uploadDone,  setUploadDone]  = useState(null);
  const [error,       setError]       = useState('');

  const addPage = useCallback((original) => {
    const p = { id:uid(), original, cropped:null, processed:original, filter:'original' };
    setPages(prev => [...prev, p]);
    return p;
  }, []);

  const handleFiles = useCallback((fileList) => {
    Array.from(fileList)
      .filter(f => f.type.startsWith('image/') || f.type==='application/pdf')
      .forEach(file => {
        const reader = new FileReader();
        reader.onload = e => addPage(e.target.result);
        reader.readAsDataURL(file);
      });
  }, [addPage]);

  const handleCamera = useCallback((dataUrl) => {
    const id = uid();
    setShowCamera(false);
    setCropPending(true);
    setPages(prev => {
      // Default 'original' — user picks filter themselves after crop
      const newPage = {id, original:dataUrl, cropped:null, processed:dataUrl, filter:'original'};
      const next = [...prev, newPage];
      const idx = next.length - 1;
      setTimeout(() => setCropIndex(idx), 30);
      return next;
    });
  }, []);

  const applyCrop = useCallback(async (idx, croppedUrl) => {
    // Save the cropped result. Then re-apply the current filter on top of it.
    // This ensures: crop is preserved, filter works from cropped base.
    const page = pages[idx];
    let processed = croppedUrl;
    if (page.filter && page.filter !== 'original') {
      try {
        processed = await applyFilterToDataUrl(croppedUrl, page.filter);
      } catch { /* keep cropped if filter fails */ }
    }
    setPages(prev => prev.map((p,i) =>
      i===idx ? {...p, cropped:croppedUrl, processed, filter: page.filter || 'original'} : p
    ));
    setCropIndex(null);
    setCropPending(false);
  }, [pages]);

  const deletePage = useCallback((idx) => {
    setPages(prev => prev.filter((_,i)=>i!==idx));
    setSelected(s => Math.max(0, s>idx ? s-1 : Math.min(s, pages.length-2)));
    if (cropIndex===idx) { setCropIndex(null); setCropPending(false); }
  }, [pages.length, cropIndex]);

  const applyFilter = useCallback(async (idx, filter) => {
    const page = pages[idx];
    // Always apply filter to 'cropped' if crop was done, else 'original'
    // This preserves the crop when switching filters
    const base = page.cropped || page.original;
    try {
      const result = await applyFilterToDataUrl(base, filter);
      setPages(prev => prev.map((p,i) => i===idx ? {...p, processed:result, filter} : p));
    } catch (err) {
      console.error('applyFilter error:', err.message);
      // Graceful fallback — don't crash, just keep current processed
    }
  }, [pages]);

  const rotate = useCallback(async (idx) => {
    try {
      const result = await rotateCW(pages[idx].processed);
      setPages(prev => prev.map((p,i) => i===idx ? {...p, processed:result} : p));
    } catch (err) { console.error('rotate error:', err.message); }
  }, [pages]);

  const movePage = useCallback((from, dir) => {
    const to = from+dir;
    if (to<0||to>=pages.length) return;
    setPages(prev => { const a=[...prev]; [a[from],a[to]]=[a[to],a[from]]; return a; });
    setSelected(to);
  }, [pages.length]);

  async function saveAndUpload() {
    if (!pages.length)   { setError('Add at least one page.'); return; }
    if (cropPending)     { setError('Please crop or skip the pending crop first.'); return; }
    if (!folder)         { setShowFolder(true); return; }
    setUploading(true); setError('');
    try {
      let blob, ext, mimeType;
      if (outputFmt==='pdf' || pages.length>1) {
        blob=await buildPDF(pages); ext='.pdf'; mimeType='application/pdf';
      } else {
        const dataUrl = pages[0].processed||pages[0].original;
        const q = outputFmt==='jpg'?'image/jpeg':'image/png';
        const canvas = document.createElement('canvas');
        const img    = await loadImg(dataUrl);
        canvas.width  = img.naturalWidth||img.width;
        canvas.height = img.naturalHeight||img.height;
        canvas.getContext('2d').drawImage(img,0,0);
        blob = await new Promise(r=>canvas.toBlob(r,q,0.98));
         // eslint-disable-next-line
        ext = outputFmt==='jpg'?'.jpg':'.png'; mimeType=q;
      }
      let name = docName.trim();
      if (!name) {
        const firstBlob = dataUrlToBlob(pages[0].processed||pages[0].original);
        const firstFile = new File([firstBlob],'scan.jpg',{type:'image/jpeg'});
        const aiName    = await suggestName(firstFile, folder.path).catch(()=>null);
        name = aiName ? sanitise(aiName) : getSequentialName(folder.path, ext).replace(ext,'');
      }
      const fileName = name.replace(/\.[^.]+$/, '')+ext;
      const form = new FormData();
      form.append('document', blob, fileName);
      form.append('folderPath', folder.path);
      form.append('customName', fileName);
      const h = await getAuthHeader();
      const {data} = await axios.post(`${BASE}/upload`, form, {
        headers:{Authorization:h,'Content-Type':'multipart/form-data'},
      });
      confirmUsed(folder.path);
      localStorage.setItem('dv_last_folder', JSON.stringify(folder));
      setUploadDone({...data.file, fileName});
    } catch(e) {
      setError(e.response?.data?.detail||e.response?.data?.error||e.message);
    } finally { setUploading(false); }
  }

  const activePage = pages[selected] || pages[0];

  // ── Crop editor full-screen overlay ───────────────────────────────────────
  if (cropIndex!==null && pages[cropIndex]) {
    return (
      <CropEditor
        page={pages[cropIndex]}
        onDone={url => applyCrop(cropIndex, url)}
        onCancel={() => setCropIndex(null)}
      />
    );
  }

  // ── Upload success screen ──────────────────────────────────────────────────
  if (uploadDone) {
    return (
      <div className="page" style={{background:'var(--cream)'}}>
        <Navbar/>
        <div style={{maxWidth:440,margin:'0 auto',padding:'48px 20px',textAlign:'center'}}>
          <div style={{fontSize:60,marginBottom:16}}>✅</div>
          <h2 style={{marginBottom:8}}>Saved to Drive!</h2>
          <p style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--ink-3)',marginBottom:4,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {uploadDone.fileName||uploadDone.name}
          </p>
          <p style={{fontSize:12,color:'var(--ink-4)',marginBottom:28}}>DocVault/{folder?.path}</p>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {uploadDone.id && (
              <ShareButton file={uploadDone} getAuthHeader={getAuthHeader} variant="full"/>
            )}
            {uploadDone.viewLink && (
              <a href={uploadDone.viewLink} target="_blank" rel="noopener noreferrer"
                style={{display:'flex',alignItems:'center',justifyContent:'center',
                  padding:'13px',borderRadius:14,border:'1.5px solid var(--border)',background:'white',
                  color:'var(--ink-2)',textDecoration:'none',fontSize:14,fontFamily:'var(--font)',fontWeight:500}}>
                Open in Drive ↗
              </a>
            )}
            <button onClick={()=>{setPages([]);setUploadDone(null);setDocName('');setSelected(0);setCropPending(false);}}
              style={{padding:'13px',borderRadius:14,border:'1.5px solid var(--border)',background:'white',
                fontSize:15,cursor:'pointer',fontFamily:'var(--font)'}}>
              Scan another
            </button>
            <button onClick={()=>navigate('/dashboard')}
              style={{padding:'11px',borderRadius:14,border:'none',background:'none',
                fontSize:14,color:'var(--ink-3)',cursor:'pointer',fontFamily:'var(--font)'}}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main scanner ───────────────────────────────────────────────────────────
  return (
    <div style={{
      height:'100vh',
      background:'#111',
      display:'flex',
      flexDirection:'column',
      overflow:'hidden',
      /* account for bottom nav */
      paddingBottom:'var(--bottom-bar-h)',
    }}>
      <Navbar darkBg/>

      {/* ── Empty state ── */}
      {pages.length===0 && (
        <div style={{flex:1,display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',gap:20,padding:'32px 24px'}}>
          <div style={{fontSize:56,opacity:.2}}>📄</div>
          <p style={{color:'rgba(255,255,255,.4)',fontSize:15,fontFamily:'var(--font)'}}>No pages yet</p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'center'}}>
            <button onClick={()=>setShowCamera(true)} style={{
              padding:'14px 24px',borderRadius:14,background:'var(--accent)',color:'white',
              border:'none',fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)',
              minHeight:52,display:'flex',alignItems:'center',gap:8,WebkitTapHighlightColor:'transparent'}}>
              📷 Use Camera
            </button>
            <button onClick={()=>fileInputRef.current?.click()} style={{
              padding:'14px 24px',borderRadius:14,background:'rgba(255,255,255,.1)',color:'rgba(255,255,255,.85)',
              border:'1.5px solid rgba(255,255,255,.18)',fontSize:15,cursor:'pointer',fontFamily:'var(--font)',
              minHeight:52,display:'flex',alignItems:'center',gap:8,WebkitTapHighlightColor:'transparent'}}>
              🖼 Gallery
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
            style={{display:'none'}} onChange={e=>handleFiles(e.target.files)}/>
        </div>
      )}

      {/* ── Pages view ── */}
      {pages.length>0 && activePage && (
        <>
          {/*
            Layout breakdown (mobile, top → bottom):
            [Navbar ~56px]
            [Preview — flex:1, takes all remaining space]
            [Filter bar — fixed ~48px]
            [Page strip — fixed 96px]
            [Bottom action bar — fixed ~auto]
            [Bottom nav ~64px]

            The preview uses flex:1 + minHeight:0 so it shrinks to
            fit without overlapping the fixed-height rows below.
          */}

          {/* Preview area */}
          <div style={{
            flex:1, minHeight:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            padding:'8px', position:'relative', overflow:'hidden',
          }}>
            <img src={activePage.processed||activePage.original} alt="current page"
              style={{
                /* Constrain to the available flex space */
                maxWidth:'100%',
                maxHeight:'100%',
                objectFit:'contain',
                borderRadius:6,
                boxShadow:'0 4px 24px rgba(0,0,0,.7)',
                display:'block',
              }}/>
            {/* Crop button — floating on preview */}
            <button onClick={()=>setCropIndex(selected)} style={{
              position:'absolute', top:12, right:12,
              background:'rgba(0,0,0,.72)',
              backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
              border:'1px solid rgba(255,255,255,.2)', color:'white',
              borderRadius:99, padding:'7px 14px', fontSize:13,
              cursor:'pointer', fontFamily:'var(--font)',
              display:'flex', alignItems:'center', gap:5,
              WebkitTapHighlightColor:'transparent',
            }}>✂️ Crop</button>
            {/* Page counter badge */}
            <div style={{
              position:'absolute', top:12, left:12,
              background:'rgba(0,0,0,.72)',
              backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
              border:'1px solid rgba(255,255,255,.2)', color:'white',
              borderRadius:99, padding:'5px 12px', fontSize:13,
              fontFamily:'var(--font)', fontWeight:600,
            }}>
              {selected+1} / {pages.length}
            </div>
          </div>

          {/* Filter + tools row — fixed height, scrollable horizontally */}
          <div style={{
            height:48, minHeight:48,
            display:'flex', alignItems:'center', gap:7,
            padding:'0 12px',
            background:'rgba(0,0,0,.88)',
            overflowX:'auto', WebkitOverflowScrolling:'touch',
            scrollbarWidth:'none', flexShrink:0,
          }}>
            {[
              {id:'original',label:'Original', icon:'📷'},
              {id:'enhance', label:'Enhance',  icon:'✨'},
              {id:'bw',      label:'B&W',      icon:'⬛'},
              {id:'magic',   label:'Magic',    icon:'🪄'},
              {id:'document',label:'Document', icon:'📄'},
            ].map(f => (
              <button key={f.id} onClick={()=>applyFilter(selected,f.id)} style={{
                padding:'6px 13px', borderRadius:99, border:'none', cursor:'pointer',
                background: activePage.filter===f.id ? 'var(--accent)' : 'rgba(255,255,255,.1)',
                color: activePage.filter===f.id ? 'white' : 'rgba(255,255,255,.75)',
                fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap',
                fontWeight: activePage.filter===f.id ? 600 : 400,
                minHeight:34, flexShrink:0,
                display:'flex', alignItems:'center', gap:4,
                WebkitTapHighlightColor:'transparent',
              }}>{f.icon} {f.label}</button>
            ))}
            <div style={{width:1,background:'rgba(255,255,255,.12)',margin:'0 3px',flexShrink:0,alignSelf:'stretch',marginTop:6,marginBottom:6}}/>
            {[
              {label:'↻ Rotate',  fn:()=>rotate(selected)},
              {label:'← Move',   fn:()=>movePage(selected,-1), dis:selected===0},
              {label:'Move →',   fn:()=>movePage(selected,1),  dis:selected===pages.length-1},
            ].map(btn => (
              <button key={btn.label} onClick={btn.fn} disabled={btn.dis} style={{
                padding:'6px 12px', borderRadius:99, border:'none', cursor:btn.dis?'default':'pointer',
                background:'rgba(255,255,255,.1)',
                color:btn.dis?'rgba(255,255,255,.25)':'rgba(255,255,255,.75)',
                fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap',
                minHeight:34, flexShrink:0,
                WebkitTapHighlightColor:'transparent',
              }}>{btn.label}</button>
            ))}
          </div>

          {/* Page strip */}
          <PageStrip pages={pages} selected={selected}
            onSelect={setSelected} onCrop={setCropIndex}
            onDelete={deletePage} onAdd={()=>setShowCamera(true)}/>

          {/* Bottom action bar */}
          <div style={{
            background:'white',
            borderTop:'1px solid var(--border-soft)',
            flexShrink:0,
            padding:'10px 12px',
            paddingBottom:'max(10px, env(safe-area-inset-bottom, 10px))',
          }}>
            {/* Row 1: Name + add-page */}
            <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center'}}>
              <input value={docName} onChange={e=>setDocName(e.target.value)}
                placeholder="Document name (auto if blank)…"
                style={{flex:1,padding:'10px 12px',border:'1.5px solid var(--border)',
                  borderRadius:10,fontFamily:'var(--font)',fontSize:16,outline:'none',
                  background:'var(--paper)',color:'var(--ink)',minHeight:44}}/>
              <button onClick={()=>fileInputRef.current?.click()} style={{
                width:44,height:44,borderRadius:10,border:'1px solid var(--border)',
                background:'var(--paper)',cursor:'pointer',fontSize:18,flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center',
                WebkitTapHighlightColor:'transparent'}}>＋</button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
                style={{display:'none'}} onChange={e=>handleFiles(e.target.files)}/>
            </div>

            {/* Row 2: Format + Folder */}
            <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'stretch'}}>
              {/* Format picker */}
              <div style={{display:'flex',gap:2,background:'var(--sand)',borderRadius:9,padding:3,flexShrink:0}}>
                {['pdf','jpg','png'].map(fmt=>(
                  <button key={fmt} onClick={()=>setOutputFmt(fmt)} style={{
                    padding:'5px 9px',borderRadius:7,
                    background:outputFmt===fmt?'white':'transparent',
                    border:'none',cursor:'pointer',fontSize:12,
                    fontWeight:outputFmt===fmt?700:400,
                    color:outputFmt===fmt?'var(--ink)':'var(--ink-3)',
                    fontFamily:'var(--font)',minHeight:34,textTransform:'uppercase',
                    boxShadow:outputFmt===fmt?'0 1px 4px rgba(0,0,0,.12)':'none',
                    WebkitTapHighlightColor:'transparent',transition:'all .15s',
                  }}>{fmt}</button>
                ))}
              </div>
              {/* Folder picker */}
              <button onClick={()=>setShowFolder(true)} style={{
                flex:1,textAlign:'left',padding:'7px 12px',
                border:`1.5px solid ${folder?'var(--accent-light)':'#e8a040'}`,
                background:folder?'var(--accent-bg)':'#fff8ee',
                borderRadius:9,cursor:'pointer',fontFamily:'var(--font)',
                display:'flex',alignItems:'center',gap:7,minHeight:44,
                WebkitTapHighlightColor:'transparent',overflow:'hidden'}}>
                <span style={{fontSize:15,flexShrink:0}}>📂</span>
                <span style={{fontSize:12,color:folder?'var(--accent)':'#9a6010',
                  flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {folder?`DocVault/${folder.path}`:'Choose folder'}
                </span>
                <span style={{fontSize:13,color:'var(--ink-4)',flexShrink:0}}>›</span>
              </button>
            </div>

            {/* Multi-page + jpg/png warning */}
            {pages.length>1 && outputFmt!=='pdf' && (
              <p style={{fontSize:11,color:'var(--amber)',marginBottom:6}}>
                ⚠️ Multiple pages → saved as PDF
              </p>
            )}

            {/* Crop pending banner */}
            {cropPending && (
              <div style={{background:'var(--amber-bg)',border:'1px solid #f0cc82',
                borderRadius:9,padding:'9px 12px',marginBottom:8,
                display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontSize:13,color:'var(--amber)',fontWeight:600,marginBottom:2}}>✂️ Crop pending</p>
                  <p style={{fontSize:11,color:'var(--amber)',opacity:.85}}>Crop the page or tap Skip to save as-is.</p>
                </div>
                <div style={{display:'flex',gap:6,flexShrink:0}}>
                  <button onClick={()=>{const idx=pages.length-1;setCropIndex(idx);}}
                    style={{padding:'6px 12px',borderRadius:8,background:'var(--accent)',
                      color:'white',border:'none',fontSize:12,fontWeight:600,
                      cursor:'pointer',fontFamily:'var(--font)',minHeight:34,
                      WebkitTapHighlightColor:'transparent'}}>✂️ Crop</button>
                  <button onClick={()=>setCropPending(false)}
                    style={{padding:'6px 12px',borderRadius:8,background:'white',
                      color:'var(--ink-3)',border:'1px solid var(--border)',
                      fontSize:12,cursor:'pointer',fontFamily:'var(--font)',minHeight:34,
                      WebkitTapHighlightColor:'transparent'}}>Skip</button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && <p style={{fontSize:12,color:'var(--red)',marginBottom:7}}>⚠ {error}</p>}

            {/* Save button */}
            <button onClick={saveAndUpload} disabled={uploading} style={{
              width:'100%',padding:'14px',borderRadius:12,
              background:uploading?'var(--accent-light)':'var(--accent)',
              color:'white',border:'none',fontSize:15,fontWeight:700,
              cursor:uploading?'default':'pointer',fontFamily:'var(--font)',
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
              minHeight:50,WebkitTapHighlightColor:'transparent',transition:'background .15s'}}>
              {uploading
                ? <><span className="spin" style={{display:'inline-block',width:16,height:16,
                    border:'2px solid rgba(255,255,255,.3)',borderTopColor:'white',borderRadius:'50%'}}/>
                    Building {outputFmt.toUpperCase()}…</>
                : `Save ${pages.length}p as ${outputFmt.toUpperCase()} →`
              }
            </button>
          </div>
        </>
      )}

      {showCamera && (
        <CameraCapture onCapture={handleCamera} onClose={()=>setShowCamera(false)}/>
      )}
      {showFolder && (
        <FolderSheet getAuthHeader={getAuthHeader} lastUsedFolderId={folder?.id}
          onSelect={f=>{setFolder(f);setShowFolder(false);}}
          onClose={()=>setShowFolder(false)}/>
      )}
    </div>
  );
}
