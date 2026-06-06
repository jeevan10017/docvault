/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BASE } from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import { ShareButton } from '../components/ShareButton';
import { cache } from '../utils/localCache';

// ─── helpers ──────────────────────────────────────────────────────────────────
const FOLDER_META = {
  Identity:  { color:'#6B4FA0', bg:'#F2EEFB', icon:'🪪' },
  Education: { color:'#9C6B1A', bg:'#FBF3E4', icon:'🎓' },
  Career:    { color:'#4A7C59', bg:'#EEF5F0', icon:'💼' },
  Finance:   { color:'#3B6EA5', bg:'#EEF3FB', icon:'💰' },
  Medical:   { color:'#B03030', bg:'#FCEAEA', icon:'🏥' },
  Property:  { color:'#CC785C', bg:'#FDF3EE', icon:'🏠' },
  Bills:     { color:'#7A5C1A', bg:'#FBF3E4', icon:'📋' },
  Other:     { color:'#6B6057', bg:'#EDE8DF', icon:'📁' },
};
function getFolderMeta(name) {
  return FOLDER_META[(name||'').split('/')[0]] || FOLDER_META.Other;
}
function formatSize(b) {
  if (!b) return '';
  const n = parseInt(b);
  if (n<1024) return n+' B';
  if (n<1048576) return (n/1024).toFixed(0)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{ display:'flex', gap:10, padding:'12px', background:'white',
      borderRadius:14, border:'1px solid var(--border-soft)', marginBottom:8 }}>
      <div style={{ width:56, height:68, borderRadius:8, background:'var(--sand)',
        animation:'pulse 1.4s ease infinite', flexShrink:0 }} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8, justifyContent:'center' }}>
        <div style={{ height:13, borderRadius:4, background:'var(--sand)',
          animation:'pulse 1.4s ease infinite', width:'70%' }} />
        <div style={{ height:11, borderRadius:4, background:'var(--sand)',
          animation:'pulse 1.4s ease infinite', width:'45%' }} />
      </div>
    </div>
  );
}

// ─── File thumbnail ───────────────────────────────────────────────────────────
function FileThumbnail({ file, getAuthHeader }) {
  const [src, setSrc] = useState(null);
  const isPDF   = file.mimeType === 'application/pdf';
  const isImage = file.mimeType?.startsWith('image/');

  useEffect(() => {
    if (!isImage && !isPDF) return;
    // Check cache first
    const cached = cache.getThumb(file.id);
    if (cached) { setSrc(cached); return; }
    if (!isImage) return; // only fetch thumbs for images

    // Fetch via thumbnail endpoint
    getAuthHeader().then(h => {
      fetch(`${BASE}/drive/file/${file.id}/thumbnail`, { headers: { Authorization: h } })
        .then(r => r.ok ? r.blob() : null)
        .then(blob => {
          if (!blob) return;
          const reader = new FileReader();
          reader.onload = e => {
            const b64 = e.target.result;
            cache.setThumb(file.id, b64);
            setSrc(b64);
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => {});
    });
  }, [file.id, isImage, isPDF, getAuthHeader]);

  return (
    <div style={{ width:56, height:68, borderRadius:8, overflow:'hidden', flexShrink:0,
      background: isPDF ? 'var(--red-bg)' : 'var(--blue-bg)',
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      {src
        ? <img src={src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <span style={{ fontSize:26 }}>{isPDF ? '📄' : isImage ? '🖼️' : '📁'}</span>
      }
    </div>
  );
}

// ─── Rename Sheet ─────────────────────────────────────────────────────────────
function RenameSheet({ file, getAuthHeader, onRenamed, onClose }) {
  const [val,    setVal]    = useState(file.name.replace(/\.[^.]+$/, ''));
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const inputRef = useRef();

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  async function save() {
    const ext  = file.name.match(/(\.[^.]+)$/)?.[1] || '';
    const name = (val.trim() || file.name.replace(/\.[^.]+$/, '')) + ext;
    setSaving(true); setErr('');
    try {
      const h = await getAuthHeader();
      const { data } = await axios.patch(
        `${BASE}/drive/file/${file.id}/rename`,
        { name },
        { headers: { Authorization: h } }
      );
      onRenamed(data.file);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight:600, fontSize:15 }}>Rename</span>
          <button onClick={onClose} style={{ background:'none', border:'none',
            fontSize:22, cursor:'pointer', color:'var(--ink-4)', padding:'4px 10px', minHeight:44 }}>×</button>
        </div>
        <div style={{ padding:'16px 20px 32px' }}>
          <p style={{ fontSize:12, color:'var(--ink-4)', marginBottom:10 }}>
            Extension kept automatically.
          </p>
          <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            style={{ width:'100%', padding:'12px 14px', border:'1.5px solid var(--border)',
              borderRadius:10, fontFamily:'var(--font)', fontSize:16, outline:'none',
              marginBottom:14, boxSizing:'border-box' }} />
          {err && <p style={{ fontSize:12, color:'var(--red)', marginBottom:10 }}>⚠ {err}</p>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={save} disabled={saving} style={{
              flex:1, padding:'13px', borderRadius:12, background:'var(--accent)',
              color:'white', border:'none', fontSize:15, fontWeight:600,
              cursor: saving ? 'default' : 'pointer', fontFamily:'var(--font)', minHeight:50,
            }}>
              {saving
                ? <span className="spin" style={{ display:'inline-block', width:16, height:16,
                    border:'2px solid rgba(255,255,255,.3)', borderTopColor:'white', borderRadius:'50%' }} />
                : 'Save'
              }
            </button>
            <button onClick={onClose} style={{
              flex:1, padding:'13px', borderRadius:12, background:'white',
              color:'var(--ink-2)', border:'1.5px solid var(--border)',
              fontSize:15, cursor:'pointer', fontFamily:'var(--font)', minHeight:50,
            }}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── File Viewer Sheet ────────────────────────────────────────────────────────
function FileViewer({ file: initialFile, getAuthHeader, onClose, onRenamed }) {
  const [file,        setFile]       = useState(initialFile);
  const [showRename,  setShowRename] = useState(false);
  const [viewUrl,     setViewUrl]    = useState(null);
  const [loadingView, setLoadingView]= useState(false);
  const isPDF   = file.mimeType === 'application/pdf';
  const isImage = file.mimeType?.startsWith('image/');

  // Load file for inline viewing
  useEffect(() => {
    if (!isPDF && !isImage) return;
    setLoadingView(true);
    getAuthHeader().then(h => {
      fetch(`${BASE}/drive/file/${file.id}/download?filename=${encodeURIComponent(file.name)}`,
        { headers: { Authorization: h } })
        .then(r => r.blob())
        .then(blob => {
          setViewUrl(URL.createObjectURL(blob));
          setLoadingView(false);
        })
        .catch(() => setLoadingView(false));
    });
    return () => { if (viewUrl) URL.revokeObjectURL(viewUrl); };
  }, [file.id]);

  function handleRenamed(updated) {
    setFile(f => ({ ...f, name: updated.name }));
    onRenamed?.(updated);
    setShowRename(false);
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" style={{ maxHeight:'96dvh', maxHeight:'96vh' }}>
        <div className="sheet-handle" />
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px',
          borderBottom:'1px solid var(--border-soft)', position:'sticky', top:0, background:'white', zIndex:2 }}>
          <button onClick={onClose} style={{ background:'none', border:'none',
            fontSize:20, cursor:'pointer', color:'var(--ink-4)', padding:'4px 8px',
            minHeight:44, minWidth:44, WebkitTapHighlightColor:'transparent' }}>‹</button>
          <span style={{ flex:1, fontWeight:600, fontSize:14, overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{file.name}</span>
          <button onClick={() => setShowRename(true)} style={{
            background:'var(--sand)', border:'none', borderRadius:8,
            padding:'6px 12px', fontSize:13, cursor:'pointer', fontFamily:'var(--font)',
            minHeight:36, WebkitTapHighlightColor:'transparent',
          }}>✏️ Rename</button>
        </div>

        {/* Viewer area */}
        <div style={{ padding:'0', flex:1, overflow:'hidden', minHeight:300, background:'var(--paper)' }}>
          {loadingView && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
              height:280, flexDirection:'column', gap:12 }}>
              <div className="spin" style={{ width:32, height:32,
                border:'2px solid var(--sand)', borderTopColor:'var(--accent)', borderRadius:'50%' }} />
              <p style={{ fontSize:13, color:'var(--ink-4)' }}>Loading…</p>
            </div>
          )}
          {!loadingView && viewUrl && isPDF && (
            <iframe
              src={viewUrl}
              title={file.name}
              style={{ width:'100%', height:'55vh', border:'none', display:'block' }}
            />
          )}
          {!loadingView && viewUrl && isImage && (
            <div style={{ padding:12, display:'flex', alignItems:'center', justifyContent:'center',
              background:'#111', minHeight:280 }}>
              <img src={viewUrl} alt={file.name}
                style={{ maxWidth:'100%', maxHeight:'55vh', objectFit:'contain', borderRadius:6,
                  boxShadow:'0 4px 20px rgba(0,0,0,.5)' }} />
            </div>
          )}
          {!loadingView && !viewUrl && !isPDF && !isImage && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
              height:200, flexDirection:'column', gap:10 }}>
              <span style={{ fontSize:48 }}>📁</span>
              <p style={{ fontSize:13, color:'var(--ink-4)' }}>Preview not available</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ padding:'14px 16px',
          paddingBottom:'max(16px, env(safe-area-inset-bottom, 16px))',
          borderTop:'1px solid var(--border-soft)', background:'white' }}>
          <div style={{ marginBottom:10 }}>
            <p style={{ fontSize:12, color:'var(--ink-3)', marginBottom:4 }}>
              {formatSize(file.size)} · {formatDate(file.createdTime)}
            </p>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <ShareButton file={file} getAuthHeader={getAuthHeader} variant="full" />
            {file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  padding:'12px', borderRadius:12, border:'1.5px solid var(--border)',
                  background:'white', color:'var(--ink-2)', textDecoration:'none',
                  fontSize:14, fontFamily:'var(--font)', fontWeight:500, minHeight:46 }}>
                Open in Drive ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {showRename && (
        <RenameSheet file={file} getAuthHeader={getAuthHeader}
          onRenamed={handleRenamed} onClose={() => setShowRename(false)} />
      )}
    </>
  );
}

// ─── Folder Row — lazy loads files with infinite scroll ───────────────────────
function FolderSection({ folder, getAuthHeader, searchQuery }) {
  const [open,        setOpen]       = useState(false);
  const [files,       setFiles]      = useState([]);
  const [loading,     setLoading]    = useState(false);
  const [nextToken,   setNextToken]  = useState(null);
  const [hasMore,     setHasMore]    = useState(true);
  const [loadingMore, setLoadingMore]= useState(false);
  const [viewFile,    setViewFile]   = useState(null);
  const sentinelRef = useRef(null);
  const PAGE_SIZE = 10;

  // Load first page when opened
  async function loadFirstPage() {
    if (loading) return;
    setLoading(true);

    // Try cache first
    const cached = cache.getFolderFiles(folder.id, 0);
    if (cached && !searchQuery) {
      setFiles(cached.files);
      setNextToken(cached.nextToken);
      setHasMore(!!cached.nextToken);
      setLoading(false);
      return;
    }

    try {
      const h = await getAuthHeader();
      const params = new URLSearchParams({ folderId: folder.id, pageSize: PAGE_SIZE });
      if (searchQuery) params.set('search', searchQuery);
      const { data } = await axios.get(`${BASE}/drive/folder-files?${params}`,
        { headers: { Authorization: h } });

      const filteredFiles = searchQuery
        ? (data.files || []).filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : (data.files || []);

      setFiles(filteredFiles);
      setNextToken(data.nextPageToken || null);
      setHasMore(!!data.nextPageToken);
      if (!searchQuery) cache.setFolderFiles(folder.id, 0, { files: filteredFiles, nextToken: data.nextPageToken });
    } catch (e) {
      console.error('Load folder files:', e.message);
    } finally { setLoading(false); }
  }

  async function loadMore() {
    if (!hasMore || loadingMore || !nextToken) return;
    setLoadingMore(true);
    try {
      const h = await getAuthHeader();
      const params = new URLSearchParams({ folderId: folder.id, pageSize: PAGE_SIZE, pageToken: nextToken });
      const { data } = await axios.get(`${BASE}/drive/folder-files?${params}`,
        { headers: { Authorization: h } });
      const more = data.files || [];
      setFiles(prev => [...prev, ...more]);
      setNextToken(data.nextPageToken || null);
      setHasMore(!!data.nextPageToken);
    } catch (e) { console.error('Load more:', e.message); }
    finally { setLoadingMore(false); }
  }

  // Infinite scroll observer
  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) loadMore();
    }, { threshold: 0.1 });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [open, hasMore, loadingMore, nextToken]);

  function handleOpen() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && files.length === 0) loadFirstPage();
  }

  function handleRenamed(updated) {
    setFiles(prev => prev.map(f => f.id === updated.id ? { ...f, name: updated.name } : f));
    cache.invalidateFolderFiles(folder.id);
  }

  const meta = getFolderMeta(folder.name);

  return (
    <div style={{ marginBottom:12 }}>
      {/* Folder header — tap to expand */}
      <div
        onClick={handleOpen}
        style={{
          display:'flex', alignItems:'center', gap:12, padding:'14px 14px',
          background:'white', borderRadius: open ? '14px 14px 0 0' : 14,
          border:'1.5px solid var(--border-soft)', cursor:'pointer',
          WebkitTapHighlightColor:'transparent',
          transition:'border-radius .2s',
        }}>
        <div style={{ width:40, height:40, minWidth:40, borderRadius:10,
          background:meta.bg, display:'flex', alignItems:'center',
          justifyContent:'center', fontSize:20 }}>{meta.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:600, fontSize:14, color:'var(--ink)' }}>{folder.name}</div>
          <div style={{ fontSize:11, color:'var(--ink-4)' }}>DocVault/{folder.path}</div>
        </div>
        <span style={{
          fontSize:18, color:'var(--ink-4)', transition:'transform .2s',
          display:'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>›</span>
      </div>

      {/* Files list — shown when open */}
      {open && (
        <div style={{ background:'var(--paper)', border:'1.5px solid var(--border-soft)',
          borderTop:'none', borderRadius:'0 0 14px 14px', padding:'8px 8px 4px',
          animation:'fadeIn .2s ease' }}>

          {/* Skeleton loading */}
          {loading && [0,1,2].map(i => <SkeletonCard key={i} />)}

          {!loading && files.length === 0 && (
            <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center',
              padding:'20px 0' }}>No files in this folder.</p>
          )}

          {!loading && files.map(file => (
            <FileCard
              key={file.id}
              file={file}
              getAuthHeader={getAuthHeader}
              onTap={() => setViewFile(file)}
            />
          ))}

          {/* Load more skeletons */}
          {loadingMore && [0,1].map(i => <SkeletonCard key={`more-${i}`} />)}

          {/* Infinite scroll sentinel */}
          {hasMore && <div ref={sentinelRef} style={{ height:1 }} />}

          {!hasMore && files.length > 0 && (
            <p style={{ fontSize:11, color:'var(--ink-4)', textAlign:'center',
              padding:'8px 0 6px' }}>All {files.length} files loaded</p>
          )}
        </div>
      )}

      {/* File viewer */}
      {viewFile && (
        <FileViewer
          file={viewFile}
          getAuthHeader={getAuthHeader}
          onClose={() => setViewFile(null)}
          onRenamed={handleRenamed}
        />
      )}
    </div>
  );
}

// ─── Individual file card with thumbnail ──────────────────────────────────────
function FileCard({ file, getAuthHeader, onTap }) {
  return (
    <div
      onClick={onTap}
      style={{ display:'flex', gap:10, padding:'10px 8px', background:'white',
        borderRadius:12, border:'1px solid var(--border-soft)', marginBottom:6,
        cursor:'pointer', WebkitTapHighlightColor:'transparent',
        transition:'background .1s',
      }}
      onTouchStart={e => e.currentTarget.style.background='var(--sand)'}
      onTouchEnd={e => e.currentTarget.style.background='white'}
    >
      <FileThumbnail file={file} getAuthHeader={getAuthHeader} />
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column',
        justifyContent:'center', gap:3 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--ink)',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {file.name}
        </div>
        <div style={{ fontSize:11, color:'var(--ink-4)', display:'flex', gap:8 }}>
          {file.size && <span>{formatSize(file.size)}</span>}
          {file.createdTime && <span>{formatDate(file.createdTime)}</span>}
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', paddingRight:2 }}>
        <ShareButton file={file} getAuthHeader={getAuthHeader} variant="pill" />
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { auth, getAuthHeader } = useAuth();
  const navigate = useNavigate();

  const [folders,       setFolders]       = useState([]);
  const [loadingFolders,setLoadingFolders]= useState(true);
  const [folderError,   setFolderError]   = useState('');
  const [search,        setSearch]        = useState('');
  const [searchActive,  setSearchActive]  = useState(false);
  const searchTimeout = useRef(null);

  const loadFolders = useCallback(async () => {
    setLoadingFolders(true); setFolderError('');

    // Try cache
    const cached = cache.getFolders();
    if (cached) { setFolders(cached); setLoadingFolders(false); }

    // Always refresh in background
    try {
      const h = await getAuthHeader();
      const { data } = await axios.get(`${BASE}/drive/folders`,
        { headers:{ Authorization:h } });
      const subFolders = (data.folders || []).filter(f => f.path !== '');
      setFolders(subFolders);
      cache.setFolders(subFolders);
    } catch (err) {
      const status = err.response?.status;
      if (!cached) {
        if (status === 403) {
          setFolderError('Permission denied. Sign out and sign in again to refresh access.');
        } else if (status === 401) {
          setFolderError('Session expired. Please sign in again.');
        } else {
          setFolderError(err.response?.data?.error || 'Could not load folders.');
        }
      }
    } finally { setLoadingFolders(false); }
  }, [getAuthHeader]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  // Debounced search
  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearchActive(val.length > 1);
    }, 300);
  }

  const displayFolders = searchActive
    ? folders.filter(f =>
        f.path.toLowerCase().includes(search.toLowerCase()) ||
        f.name.toLowerCase().includes(search.toLowerCase()))
    : folders;

  const firstName = auth?.user?.name?.split(' ')[0] || 'My';

  return (
    <div className="page" style={{ background:'var(--cream)' }}>
      <Navbar />
      <main style={{ maxWidth:680, margin:'0 auto' }}>

        {/* Header */}
        <div style={{ padding:'18px 16px 14px', background:'white',
          borderBottom:'1px solid var(--border-soft)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div>
              <h1 style={{ fontSize:'clamp(1.1rem,5vw,1.4rem)', marginBottom:2 }}>
                {firstName}'s Vault
              </h1>
              <p style={{ fontSize:12, color:'var(--ink-4)' }}>
                {loadingFolders ? 'Loading…' : `${folders.length} folder${folders.length!==1?'s':''}`}
              </p>
            </div>
            <button onClick={() => { cache.invalidateAll(); loadFolders(); }}
              style={{ background:'none', border:'1px solid var(--border)', borderRadius:8,
                padding:'7px 12px', fontSize:12, color:'var(--ink-3)', cursor:'pointer',
                fontFamily:'var(--font)', minHeight:36 }}>
              ↻
            </button>
          </div>
          <div style={{ position:'relative' }}>
            <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
              fontSize:15, color:'var(--ink-4)', pointerEvents:'none' }}>🔍</span>
            <input
              type="search" placeholder="Search folders or files…"
              value={search} onChange={e => handleSearch(e.target.value)}
              style={{ width:'100%', padding:'10px 14px 10px 38px',
                border:'1.5px solid var(--border)', borderRadius:10,
                fontFamily:'var(--font)', fontSize:16, outline:'none',
                background:'white', color:'var(--ink)', minHeight:44,
                boxSizing:'border-box' }}
            />
          </div>
        </div>

        <div style={{ padding:'14px 14px' }}>

          {/* Error */}
          {folderError && (
            <div style={{ background:'var(--red-bg)', border:'1px solid #FFCDD2',
              borderRadius:12, padding:'14px 16px', marginBottom:14 }}>
              <p style={{ color:'var(--red)', fontSize:13, marginBottom: folderError.includes('Permission') ? 8 : 0 }}>
                ⚠ {folderError}
              </p>
              {folderError.includes('Permission') && (
                <p style={{ fontSize:12, color:'var(--red)', opacity:.8, lineHeight:1.5 }}>
                  Fix: Sign out (top right) → sign in again → approve Google Drive when prompted.
                </p>
              )}
            </div>
          )}

          {/* Folder skeleton */}
          {loadingFolders && !folders.length && [0,1,2,3].map(i => (
            <div key={i} style={{ height:68, borderRadius:14, background:'white',
              border:'1px solid var(--border-soft)', marginBottom:10,
              animation:'pulse 1.4s ease infinite' }} />
          ))}

          {/* Empty */}
          {!loadingFolders && !folderError && folders.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 20px' }}>
              <div style={{ fontSize:52, marginBottom:14, opacity:.3 }}>🗄️</div>
              <h2 style={{ marginBottom:10, fontSize:'1.1rem' }}>Vault is empty</h2>
              <p style={{ color:'var(--ink-3)', marginBottom:24, fontSize:14, lineHeight:1.6 }}>
                Scan a document or upload a file to get started.
              </p>
              <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
                <button onClick={() => navigate('/scan')} style={{
                  padding:'12px 20px', borderRadius:12, background:'var(--accent)',
                  color:'white', border:'none', fontSize:14, fontWeight:600,
                  cursor:'pointer', fontFamily:'var(--font)',
                }}>📷 Scan</button>
                <button onClick={() => navigate('/upload')} style={{
                  padding:'12px 20px', borderRadius:12, background:'white',
                  color:'var(--ink-2)', border:'1.5px solid var(--border)',
                  fontSize:14, cursor:'pointer', fontFamily:'var(--font)',
                }}>☁️ Upload</button>
              </div>
            </div>
          )}

          {/* No search results */}
          {!loadingFolders && folders.length > 0 && displayFolders.length === 0 && search && (
            <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--ink-4)' }}>
              <div style={{ fontSize:32, marginBottom:10, opacity:.4 }}>🔍</div>
              <p style={{ fontSize:14 }}>No folders match <strong>"{search}"</strong></p>
              <button onClick={() => { setSearch(''); setSearchActive(false); }}
                style={{ marginTop:12, background:'none', border:'none',
                  color:'var(--accent)', cursor:'pointer', fontSize:13, fontFamily:'var(--font)' }}>
                Clear
              </button>
            </div>
          )}

          {/* Folder sections */}
          {displayFolders.map(folder => (
            <FolderSection
              key={folder.id}
              folder={folder}
              getAuthHeader={getAuthHeader}
              searchQuery={searchActive ? search : ''}
            />
          ))}

          <div style={{ height:20 }} />
        </div>
      </main>

      {/* FAB */}
      <button className="fab" onClick={() => navigate('/scan')} title="Scan document">📷</button>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      `}</style>
    </div>
  );
}
