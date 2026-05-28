import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Navbar from '../../components/Navbar';
import PageEditor from './PageEditor';
import FolderSheet from '../../components/FolderSheet';
import axios from 'axios';
import { BASE } from '../../utils/api';

// ─── helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function applyFilter(canvas, filter) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  if (filter === 'bw') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i] = d[i+1] = d[i+2] = g;
    }
  } else if (filter === 'enhance') {
    // increase contrast + slight sharpen
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.min(255, Math.max(0, (d[i]   - 128) * 1.4 + 128));
      d[i+1] = Math.min(255, Math.max(0, (d[i+1] - 128) * 1.4 + 128));
      d[i+2] = Math.min(255, Math.max(0, (d[i+2] - 128) * 1.4 + 128));
    }
  } else if (filter === 'magic') {
    // magic colour: grayscale + high contrast = "scanned doc" look
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      g = g > 180 ? 255 : g < 80 ? 0 : (g - 80) / 100 * 255;
      d[i] = d[i+1] = d[i+2] = Math.min(255, g);
    }
  }
  // 'original' → no change
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function rotateCW(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.height; c.height = img.width;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bin  = atob(data);
  const arr  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ─── Camera capture ───────────────────────────────────────────────────────────
function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(s => {
      stream = s;
      videoRef.current.srcObject = s;
      setReady(true);
    }).catch(e => setError('Camera unavailable: ' + e.message));
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  function shoot() {
    const v = videoRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onCapture(c.toDataURL('image/jpeg', 0.95));
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:300, display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px' }}>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'white', fontSize:28, cursor:'pointer', lineHeight:1 }}>×</button>
        <span style={{ color:'rgba(255,255,255,.7)', fontSize:13 }}>Point at document</span>
        <div style={{ width:32 }} />
      </div>
      {error && <p style={{ color:'#f87', textAlign:'center', fontSize:13, padding:'20px' }}>{error}</p>}
      <video ref={videoRef} autoPlay playsInline muted style={{ flex:1, objectFit:'cover', width:'100%' }} />
      {ready && (
        <div style={{ padding:'24px 0 36px', display:'flex', justifyContent:'center' }}>
          <button onClick={shoot} style={{
            width:70, height:70, borderRadius:'50%', border:'4px solid white',
            background:'rgba(255,255,255,.2)', cursor:'pointer', transition:'transform .1s',
          }} onMouseDown={e => e.currentTarget.style.transform='scale(.92)'}
             onMouseUp={e => e.currentTarget.style.transform='scale(1)'} />
        </div>
      )}
    </div>
  );
}

// ─── Page strip at bottom ─────────────────────────────────────────────────────
function PageStrip({ pages, selected, onSelect, onDelete, onAdd }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:8,
      padding:'10px 16px', background:'white', borderTop:'1px solid var(--border-soft)',
      overflowX:'auto', WebkitOverflowScrolling:'touch',
    }}>
      {pages.map((p, i) => (
        <div key={p.id} onClick={() => onSelect(i)}
          style={{
            position:'relative', minWidth:52, width:52, height:68, borderRadius:6,
            border:`2px solid ${selected === i ? 'var(--accent)' : 'var(--border-soft)'}`,
            overflow:'hidden', cursor:'pointer', flexShrink:0,
          }}>
          <img src={p.processed || p.original} alt={`p${i+1}`}
            style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          <div style={{
            position:'absolute', bottom:0, left:0, right:0,
            background:'rgba(0,0,0,.55)', color:'white', fontSize:10,
            textAlign:'center', padding:'2px 0',
          }}>{i + 1}</div>
          <button onClick={e => { e.stopPropagation(); onDelete(i); }} style={{
            position:'absolute', top:2, right:2, width:18, height:18,
            borderRadius:'50%', background:'rgba(0,0,0,.6)', border:'none',
            color:'white', fontSize:11, cursor:'pointer', lineHeight:1,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>×</button>
        </div>
      ))}

      {/* Add page button */}
      <button onClick={onAdd} style={{
        minWidth:52, width:52, height:68, borderRadius:6,
        border:'2px dashed var(--border)', background:'var(--paper)',
        cursor:'pointer', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', gap:3, flexShrink:0,
      }}>
        <span style={{ fontSize:22, color:'var(--accent)', lineHeight:1 }}>＋</span>
        <span style={{ fontSize:9, color:'var(--ink-4)' }}>Add</span>
      </button>
    </div>
  );
}

// ─── Main Scanner Page ────────────────────────────────────────────────────────
export default function ScannerPage() {
  const { getAuthHeader } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef();

  const [pages, setPages]           = useState([]);   // [{id,original,processed,filter,rotation}]
  const [selected, setSelected]     = useState(0);    // index of active page
  const [showCamera, setShowCamera] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [docName, setDocName]       = useState('Scanned Document');
  const [folder, setFolder]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')); } catch { return null; }
  });
  const [uploading, setUploading]   = useState(false);
  const [uploadDone, setUploadDone] = useState(null);
  const [error, setError]           = useState('');

  // ── Add pages from files ──
  function handleFiles(files) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    arr.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        setPages(prev => [...prev, { id: uid(), original: e.target.result, processed: e.target.result, filter: 'original', rotation: 0 }]);
        setSelected(prev => pages.length + arr.indexOf(file));
      };
      reader.readAsDataURL(file);
    });
  }

  function handleCamera(dataUrl) {
    setPages(prev => {
      const newPage = { id: uid(), original: dataUrl, processed: dataUrl, filter: 'original', rotation: 0 };
      return [...prev, newPage];
    });
    setSelected(pages.length);
    setShowCamera(false);
  }

  function deletePage(idx) {
    setPages(prev => prev.filter((_, i) => i !== idx));
    setSelected(s => Math.max(0, s > idx ? s - 1 : s));
  }

  // ── Apply filter to current page ──
  async function applyFilterToPage(pageIdx, filterName) {
    const page = pages[pageIdx];
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const result = applyFilter(c, filterName);
      setPages(prev => prev.map((p, i) => i === pageIdx ? { ...p, processed: result, filter: filterName } : p));
    };
    img.src = page.original;
  }

  async function rotatePage(pageIdx) {
    const page = pages[pageIdx];
    const rotated = await rotateCW(page.processed);
    setPages(prev => prev.map((p, i) => i === pageIdx ? { ...p, processed: rotated } : p));
  }

  // ── Move pages ──
  function movePage(from, to) {
    if (to < 0 || to >= pages.length) return;
    setPages(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
    setSelected(to);
  }

  // ── Build PDF and upload ──
  async function buildAndUpload() {
    if (!pages.length) return setError('Add at least one page first.');
    if (!folder) return setShowFolder(true);

    setUploading(true); setError('');
    try {
      // Build PDF client-side using jsPDF
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const W = 595.28, H = 841.89;

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        const dataUrl = pages[i].processed || pages[i].original;
        const img = await loadImage(dataUrl);
        const ratio = Math.min(W / img.width, H / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        const x = (W - w) / 2, y = (H - h) / 2;
        pdf.addImage(dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
      }

      const pdfBlob = pdf.output('blob');
      const fileName = docName.trim().replace(/\.pdf$/i, '') + '.pdf';

      const formData = new FormData();
      formData.append('document', pdfBlob, fileName);
      formData.append('folderId',   folder.id);
      formData.append('folderPath', folder.path);
      formData.append('customName', fileName);

      const h = await getAuthHeader();
      const { data } = await axios.post(`${BASE}/upload`, formData, {
        headers: { Authorization: h, 'Content-Type': 'multipart/form-data' },
      });

      setUploadDone(data.file);
      localStorage.setItem('dv_last_folder', JSON.stringify(folder));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  const activePage = pages[selected];

  if (uploadDone) {
    return (
      <div className="page" style={{ background:'var(--cream)' }}>
        <Navbar />
        <div style={{ maxWidth:500, margin:'0 auto', padding:'60px 20px', textAlign:'center' }}>
          <div style={{ fontSize:60, marginBottom:16 }}>✅</div>
          <h2 style={{ marginBottom:8 }}>PDF saved to Drive!</h2>
          <p style={{ fontSize:14, color:'var(--ink-3)', marginBottom:6 }}>
            <span className="mono">{uploadDone.name}</span>
          </p>
          <p style={{ fontSize:13, color:'var(--ink-4)', marginBottom:28 }}>
            DocVault/{folder?.path}
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {uploadDone.viewLink && (
              <a href={uploadDone.viewLink} target="_blank" rel="noopener noreferrer"
                className="btn btn-primary btn-full" style={{ fontSize:15, padding:'13px', textDecoration:'none' }}>
                Open in Drive ↗
              </a>
            )}
            <button className="btn btn-secondary btn-full" onClick={() => { setPages([]); setUploadDone(null); setDocName('Scanned Document'); }}
              style={{ fontSize:14 }}>
              Scan another document
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => navigate('/dashboard')}
              style={{ fontSize:14 }}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100vh', background:'#1a1a1a', display:'flex', flexDirection:'column', paddingBottom:'var(--bottom-bar-h)' }}>
      <Navbar darkBg />

      {/* ── Empty state ── */}
      {pages.length === 0 && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 20px', gap:16 }}>
          <div style={{ fontSize:56, opacity:.3 }}>📄</div>
          <p style={{ color:'rgba(255,255,255,.5)', fontSize:15 }}>No pages yet</p>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
            <button className="btn btn-primary" onClick={() => setShowCamera(true)} style={{ fontSize:14 }}>
              📷 Use Camera
            </button>
            <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}
              style={{ fontSize:14, borderColor:'rgba(255,255,255,.25)', color:'white' }}>
              🖼 Pick Files
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
            style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
        </div>
      )}

      {/* ── Page preview ── */}
      {pages.length > 0 && activePage && (
        <>
          {/* Main preview */}
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'12px', minHeight:0, overflow:'hidden' }}>
            <img src={activePage.processed || activePage.original} alt="page"
              style={{ maxWidth:'100%', maxHeight:'calc(100vh - 340px)', objectFit:'contain', borderRadius:8, boxShadow:'0 8px 32px rgba(0,0,0,.5)' }} />
          </div>

          {/* Filter toolbar */}
          <div style={{
            display:'flex', gap:8, padding:'8px 16px', overflowX:'auto',
            background:'rgba(0,0,0,.4)', WebkitOverflowScrolling:'touch',
          }}>
            {[
              { id:'original', label:'Original' },
              { id:'enhance',  label:'Enhance' },
              { id:'bw',       label:'B&W' },
              { id:'magic',    label:'Magic' },
            ].map(f => (
              <button key={f.id} onClick={() => applyFilterToPage(selected, f.id)}
                style={{
                  padding:'6px 14px', borderRadius:99, border:'none', cursor:'pointer',
                  background: activePage.filter === f.id ? 'var(--accent)' : 'rgba(255,255,255,.12)',
                  color: activePage.filter === f.id ? 'white' : 'rgba(255,255,255,.8)',
                  fontSize:12, fontFamily:'var(--font)', whiteSpace:'nowrap', fontWeight: activePage.filter === f.id ? 600 : 400,
                  transition:'all .15s',
                }}>
                {f.label}
              </button>
            ))}

            <div style={{ width:1, background:'rgba(255,255,255,.15)', flexShrink:0, margin:'0 4px' }} />

            <button onClick={() => rotatePage(selected)} style={{
              padding:'6px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.12)', color:'rgba(255,255,255,.8)', fontSize:12, fontFamily:'var(--font)',
            }}>↻ Rotate</button>

            <button onClick={() => { if (selected > 0) movePage(selected, selected - 1); }} style={{
              padding:'6px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.12)', color:'rgba(255,255,255,.8)', fontSize:12, fontFamily:'var(--font)',
            }}>← Move</button>

            <button onClick={() => { if (selected < pages.length - 1) movePage(selected, selected + 1); }} style={{
              padding:'6px 12px', borderRadius:99, border:'none', cursor:'pointer',
              background:'rgba(255,255,255,.12)', color:'rgba(255,255,255,.8)', fontSize:12, fontFamily:'var(--font)',
            }}>Move →</button>
          </div>

          {/* Page strip */}
          <PageStrip pages={pages} selected={selected} onSelect={setSelected}
            onDelete={deletePage}
            onAdd={() => setShowCamera(true)} />

          {/* Bottom action bar */}
          <div style={{ background:'white', padding:'12px 16px', borderTop:'1px solid var(--border-soft)' }}>
            {/* Doc name */}
            <div style={{ display:'flex', gap:10, marginBottom:10, alignItems:'center' }}>
              <input
                className="input"
                value={docName}
                onChange={e => setDocName(e.target.value)}
                style={{ flex:1, fontSize:14 }}
                placeholder="Document name…"
              />
              <button onClick={() => fileInputRef.current?.click()} style={{
                width:44, height:44, borderRadius:'var(--r)', border:'1px solid var(--border)',
                background:'var(--paper)', cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center',
              }}>＋</button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf"
                style={{ display:'none' }} onChange={e => handleFiles(e.target.files)} />
            </div>

            {/* Folder row */}
            <button onClick={() => setShowFolder(true)}
              style={{
                width:'100%', textAlign:'left', padding:'9px 12px', marginBottom:10,
                border:`1.5px solid ${folder ? 'var(--accent-light)' : 'var(--amber)'}`,
                background: folder ? 'var(--accent-bg)' : 'var(--amber-bg)',
                borderRadius:'var(--r)', cursor:'pointer',
                display:'flex', alignItems:'center', gap:8, fontFamily:'var(--font)',
              }}>
              <span style={{ fontSize:16 }}>📂</span>
              <span style={{ fontSize:13, color: folder ? 'var(--accent)' : 'var(--amber)', flex:1 }}>
                {folder ? `DocVault/${folder.path}` : 'Tap to choose folder'}
              </span>
              <span style={{ fontSize:12, color:'var(--ink-4)' }}>›</span>
            </button>

            {error && <p style={{ fontSize:12, color:'var(--red)', marginBottom:8 }}>⚠ {error}</p>}

            <button className="btn btn-primary btn-full" onClick={buildAndUpload} disabled={uploading}
              style={{ fontSize:15, padding:'14px' }}>
              {uploading
                ? <><span className="spin" style={{ display:'inline-block', width:16, height:16, border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} /> Building PDF…</>
                : `Save ${pages.length} page${pages.length !== 1 ? 's' : ''} as PDF →`
              }
            </button>
          </div>
        </>
      )}

      {showCamera && <CameraCapture onCapture={handleCamera} onClose={() => setShowCamera(false)} />}

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
