import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BASE } from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import { ShareButton } from '../components/ShareButton';

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
function formatSize(bytes) {
  if (!bytes) return '';
  const n = parseInt(bytes);
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(0) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}



// ─── Document detail sheet ────────────────────────────────────────────────────
function DocSheet({ file, getAuthHeader, onClose }) {
  const isPDF   = file.mimeType === 'application/pdf';
  const isImage = file.mimeType?.startsWith('image/');

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight:600, fontSize:15, overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'75%' }}>
            {file.name}
          </span>
          <button onClick={onClose} style={{
            background:'none', border:'none', fontSize:22, cursor:'pointer',
            color:'var(--ink-4)', padding:'4px 10px', minHeight:44, lineHeight:1,
          }}>×</button>
        </div>

        <div style={{ padding:'20px 20px', paddingBottom:'max(24px, env(safe-area-inset-bottom, 24px))', overflowY:'auto' }}>
          {/* Icon */}
          <div style={{
            width:68, height:68, borderRadius:16, margin:'0 auto 18px',
            background: isPDF ? 'var(--red-bg)' : isImage ? 'var(--blue-bg)' : 'var(--sand)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:32,
          }}>
            {isPDF ? '📄' : isImage ? '🖼️' : '📁'}
          </div>

          {/* Meta */}
          {[
            { label:'Name',     value: file.name },
            { label:'Type',     value: isPDF ? 'PDF Document' : isImage ? 'Image' : file.mimeType },
            { label:'Size',     value: formatSize(file.size) },
            { label:'Saved on', value: formatDate(file.createdTime) },
          ].filter(r => r.value).map(row => (
            <div key={row.label} style={{
              display:'flex', justifyContent:'space-between', alignItems:'flex-start',
              padding:'11px 0', borderBottom:'1px solid var(--border-soft)',
            }}>
              <span style={{ fontSize:13, color:'var(--ink-4)', minWidth:72 }}>{row.label}</span>
              <span style={{ fontSize:13, color:'var(--ink-2)', fontWeight:500,
                textAlign:'right', maxWidth:'65%', wordBreak:'break-all' }}>{row.value}</span>
            </div>
          ))}

          {/* Actions */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:22 }}>
            <ShareButton file={file} getAuthHeader={getAuthHeader} variant="full" />

            {file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                style={{
                  display:'flex', alignItems:'center', justifyContent:'center',
                  padding:'13px', borderRadius:13,
                  border:'1.5px solid var(--border)', background:'white',
                  color:'var(--ink-2)', textDecoration:'none', fontSize:14,
                  fontFamily:'var(--font)', fontWeight:500, minHeight:50,
                  WebkitTapHighlightColor:'transparent',
                }}>
                Open in Google Drive ↗
              </a>
            )}

            <button onClick={onClose} style={{
              padding:'12px', borderRadius:13, border:'none', background:'none',
              fontSize:14, color:'var(--ink-4)', cursor:'pointer',
              fontFamily:'var(--font)', minHeight:44,
              WebkitTapHighlightColor:'transparent',
            }}>Close</button>
          </div>

          <p style={{ fontSize:11, color:'var(--ink-4)', textAlign:'center',
            marginTop:10, lineHeight:1.5 }}>
            On mobile, Share opens WhatsApp, Telegram, AirDrop & more.
            On desktop, the file downloads directly.
          </p>
        </div>
      </div>
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { auth, getAuthHeader } = useAuth();
  const navigate = useNavigate();

  const [files,       setFiles]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [search,      setSearch]      = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [activeTab,   setActiveTab]   = useState('all');

  const fetchFiles = useCallback(async (query = '') => {
    setLoading(true); setError('');
    try {
      const h = await getAuthHeader();
      // /all-files recursively finds ALL files in DocVault — including old uploads
      const params = query ? `?search=${encodeURIComponent(query)}` : '';
      const { data } = await axios.get(`${BASE}/drive/all-files${params}`, { headers:{ Authorization:h } });
      setFiles(data.files || []);
    } catch (err) {
      const status = err.response?.status;
      const msg    = err.response?.data?.error || err.message;
      if (status === 401) {
        setError('Session expired — sign out and sign in again.');
      } else if (status === 403) {
        setError('Permission denied. Sign out and sign in again to grant Drive access.');
      } else {
        setError(msg || 'Could not load files.');
      }
    } finally { setLoading(false); }
  }, [getAuthHeader]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const isFolder   = f => f.mimeType === 'application/vnd.google-apps.folder';
  const allDocs    = files.filter(f => !isFolder(f));
  const allFolders = files.filter(f =>  isFolder(f));
  const sl         = search.toLowerCase();
  const filteredDocs    = allDocs.filter(f => f.name.toLowerCase().includes(sl));
  const filteredFolders = allFolders.filter(f => f.name.toLowerCase().includes(sl));
  const recentDocs = [...allDocs]
    .sort((a,b) => new Date(b.createdTime) - new Date(a.createdTime))
    .slice(0, 10);

  const firstName = auth?.user?.name?.split(' ')[0] || 'My';

  return (
    <div className="page" style={{ background:'var(--cream)' }}>
      <Navbar />
      <main style={{ maxWidth:680, margin:'0 auto' }}>

        {/* Header + search */}
        <div style={{ padding:'20px 16px 14px', background:'white',
          borderBottom:'1px solid var(--border-soft)' }}>
          <h1 style={{ fontSize:'clamp(1.2rem,5vw,1.5rem)', marginBottom:2 }}>
            {firstName}'s Vault
          </h1>
          <p style={{ fontSize:13, color:'var(--ink-3)' }}>
            {loading ? 'Loading…'
              : `${allDocs.length} doc${allDocs.length!==1?'s':''} · ${allFolders.length} folder${allFolders.length!==1?'s':''}`}
          </p>
          <div style={{ position:'relative', marginTop:14 }}>
            <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)',
              fontSize:15, color:'var(--ink-4)', pointerEvents:'none' }}>🔍</span>
            <input
              type="search" placeholder="Search…" value={search}
              onChange={e => {
                setSearch(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') fetchFiles(e.target.value);
              }}
              style={{ width:'100%', padding:'10px 14px 10px 38px',
                border:'1.5px solid var(--border)', borderRadius:10,
                fontFamily:'var(--font)', fontSize:16, outline:'none',
                background:'white', color:'var(--ink)', minHeight:44 }}
            />
          </div>
        </div>

        {/* Tab bar */}
        {!loading && !error && files.length > 0 && (
          <div style={{ display:'flex', background:'white',
            borderBottom:'1px solid var(--border-soft)',
            overflowX:'auto', WebkitOverflowScrolling:'touch', scrollbarWidth:'none' }}>
            {[
              { key:'all',     label:`All (${allDocs.length})` },
              { key:'folders', label:`Folders (${allFolders.length})` },
              { key:'recent',  label:'Recent' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                flex:1, padding:'12px 8px', fontSize:13,
                fontWeight: activeTab===tab.key ? 600 : 400,
                color: activeTab===tab.key ? 'var(--accent)' : 'var(--ink-3)',
                background:'none', border:'none', cursor:'pointer',
                borderBottom:`2px solid ${activeTab===tab.key ? 'var(--accent)' : 'transparent'}`,
                whiteSpace:'nowrap', fontFamily:'var(--font)',
                transition:'color .15s', minHeight:44,
              }}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding:'16px' }}>

          {/* Loading */}
          {loading && (
            <div style={{ textAlign:'center', padding:'60px 0' }}>
              <div className="spin" style={{ width:32, height:32, margin:'0 auto 14px',
                border:'2px solid var(--sand)', borderTopColor:'var(--accent)', borderRadius:'50%' }} />
              <p style={{ color:'var(--ink-4)', fontSize:14 }}>Loading your vault…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={{ background:'var(--red-bg)', border:'1px solid #FFCDD2',
              borderRadius:14, padding:16, marginBottom:16 }}>
              <p style={{ color:'var(--red)', fontSize:13, marginBottom:8 }}>⚠ {error}</p>
              {error.includes('Permission') || error.includes('sign in') ? (
                <p style={{ fontSize:12, color:'var(--red)', opacity:.8, marginBottom:10, lineHeight:1.5 }}>
                  Fix: tap Sign out (top right) → sign in again → allow Google Drive permission when prompted.
                </p>
              ) : null}
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => fetchFiles()} style={{
                  background:'none', border:'1px solid var(--red)', borderRadius:7,
                  color:'var(--red)', fontSize:12, padding:'6px 12px', cursor:'pointer',
                  fontFamily:'var(--font)',
                }}>Retry</button>
              </div>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && files.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 20px' }}>
              <div style={{ fontSize:56, marginBottom:16, opacity:.35 }}>🗄️</div>
              <h2 style={{ marginBottom:10, fontSize:'1.1rem' }}>Your vault is empty</h2>
              <p style={{ color:'var(--ink-3)', marginBottom:28, fontSize:14, lineHeight:1.6 }}>
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
          {!loading && !error && files.length > 0 && search
            && filteredDocs.length === 0 && filteredFolders.length === 0 && (
            <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--ink-4)' }}>
              <div style={{ fontSize:36, marginBottom:10, opacity:.4 }}>🔍</div>
              <p style={{ fontSize:14 }}>No results for <strong>"{search}"</strong></p>
              <button onClick={() => setSearch('')}
                style={{ marginTop:12, background:'none', border:'none',
                  color:'var(--accent)', cursor:'pointer', fontSize:13, fontFamily:'var(--font)' }}>
                Clear search
              </button>
            </div>
          )}

          {/* Folders tab */}
          {!loading && !error && activeTab === 'folders' && (
            <section>
              <p className="section-label">Folders in DocVault</p>
              {filteredFolders.length === 0 && (
                <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center', padding:'24px 0' }}>No folders yet.</p>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {filteredFolders.map(folder => {
                  const meta = getFolderMeta(folder.name);
                  return (
                    <a key={folder.id} href={folder.webViewLink} target="_blank"
                      rel="noopener noreferrer" style={{ textDecoration:'none' }}>
                      <div className="card" style={{ padding:'14px 12px',
                        display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:38, height:38, minWidth:38, borderRadius:10,
                          background:meta.bg, display:'flex', alignItems:'center',
                          justifyContent:'center', fontSize:20 }}>{meta.icon}</div>
                        <span style={{ fontSize:13, fontWeight:500, color:'var(--ink-2)',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {folder.name}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* All / Recent tab */}
          {!loading && !error && (activeTab === 'all' || activeTab === 'recent') && (() => {
            const docs = activeTab === 'recent' ? recentDocs
              : search ? filteredDocs : allDocs;
            if (docs.length === 0 && !search) return (
              <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center', padding:'24px 0' }}>
                {activeTab === 'recent' ? 'No recent documents.' : 'No documents yet.'}
              </p>
            );
            return (
              <section>
                <div style={{ display:'flex', alignItems:'center',
                  justifyContent:'space-between', marginBottom:10 }}>
                  <p className="section-label">
                    {activeTab==='recent' ? 'Recently uploaded' : `Documents · ${docs.length}`}
                  </p>
                  <button onClick={fetchFiles} style={{
                    background:'none', border:'none', color:'var(--ink-4)',
                    fontSize:12, cursor:'pointer', fontFamily:'var(--font)', padding:'4px 8px',
                  }}>↻ Refresh</button>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {docs.map(file => {
                    const isPDF   = file.mimeType === 'application/pdf';
                    const isImage = file.mimeType?.startsWith('image/');
                    return (
                      <div key={file.id} className="card fade-in"
                        style={{ padding:'12px 12px', display:'flex',
                          alignItems:'center', gap:10 }}>
                        {/* Icon tap → detail sheet */}
                        <div onClick={() => setSelectedDoc(file)} style={{
                          width:42, height:42, minWidth:42, borderRadius:10,
                          background: isPDF ? 'var(--red-bg)' : isImage ? 'var(--blue-bg)' : 'var(--sand)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:20, cursor:'pointer', flexShrink:0,
                        }}>
                          {isPDF ? '📄' : isImage ? '🖼️' : '📁'}
                        </div>

                        {/* Name tap → detail sheet */}
                        <div style={{ flex:1, minWidth:0, cursor:'pointer' }}
                          onClick={() => setSelectedDoc(file)}>
                          <div style={{ fontSize:13, fontWeight:500, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}>
                            {file.name}
                          </div>
                          <div style={{ fontSize:11, color:'var(--ink-4)',
                            display:'flex', gap:8, flexWrap:'wrap' }}>
                            {file.size && <span>{formatSize(file.size)}</span>}
                            {file.createdTime && <span>{formatDate(file.createdTime)}</span>}
                          </div>
                        </div>

                        {/* Inline share pill */}
                        <ShareButton file={file} getAuthHeader={getAuthHeader} variant="pill" />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          <div style={{ height:24 }} />
        </div>
      </main>

      {/* FAB */}
      <button className="fab" onClick={() => navigate('/scan')} title="Scan document">
        📷
      </button>

      {/* Detail sheet */}
      {selectedDoc && (
        <DocSheet
          file={selectedDoc}
          getAuthHeader={getAuthHeader}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}
