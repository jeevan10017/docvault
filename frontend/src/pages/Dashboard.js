import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BASE } from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';

const FOLDER_META = {
  'Identity':  { color: '#6B4FA0', bg: '#F2EEFB', icon: '🪪' },
  'Education': { color: '#9C6B1A', bg: '#FBF3E4', icon: '🎓' },
  'Career':    { color: '#4A7C59', bg: '#EEF5F0', icon: '💼' },
  'Finance':   { color: '#3B6EA5', bg: '#EEF3FB', icon: '💰' },
  'Medical':   { color: '#B03030', bg: '#FCEAEA', icon: '🏥' },
  'Property':  { color: '#CC785C', bg: '#FDF3EE', icon: '🏠' },
  'Bills':     { color: '#7A5C1A', bg: '#FBF3E4', icon: '📋' },
  'Other':     { color: '#6B6057', bg: '#EDE8DF', icon: '📁' },
};

function getFolderMeta(name) {
  const top = (name || '').split('/')[0];
  return FOLDER_META[top] || FOLDER_META['Other'];
}

function formatSize(bytes) {
  if (!bytes) return '';
  const n = parseInt(bytes);
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div className="spin" style={{
        width: 32, height: 32,
        border: '2px solid var(--sand)', borderTopColor: 'var(--accent)',
        borderRadius: '50%', margin: '0 auto 14px',
      }} />
      <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>Loading your vault…</p>
    </div>
  );
}

// ── Document detail + share bottom sheet ──────────────────────────────────────
function DocSheet({ file, getAuthHeader, onClose }) {
  const isPDF   = file.mimeType === 'application/pdf';
  const isImage = file.mimeType?.startsWith('image/');

  // Share state machine: idle → downloading → sharing → done | error
  const [shareState, setShareState] = useState('idle'); // idle|downloading|sharing|done|error
  const [shareError, setShareError] = useState('');
  const [progress,   setProgress]   = useState(0); // 0-100

  // Can this browser share files natively?
  const canNativeShare = typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';

  async function handleShare() {
    setShareState('downloading');
    setShareError('');
    setProgress(0);

    try {
      const authHeader = await getAuthHeader();

      // Stream file from backend → Drive → browser as blob
      const response = await fetch(
        `${BASE}/drive/file/${file.id}/download?filename=${encodeURIComponent(file.name)}`,
        { headers: { Authorization: authHeader } }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || 'Download failed');
      }

      // Stream with progress tracking
      const contentLength = parseInt(response.headers.get('Content-Length') || file.size || '0');
      const reader        = response.body.getReader();
      const chunks        = [];
      let   received      = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) setProgress(Math.round((received / contentLength) * 100));
      }

      const blob = new Blob(chunks, { type: file.mimeType || 'application/octet-stream' });
      const shareFile = new File([blob], file.name, { type: blob.type });

      setShareState('sharing');

      // Try native share sheet first (WhatsApp, Telegram, AirDrop, Email, etc.)
      if (canNativeShare && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          title: file.name,
        });
        setShareState('done');
        setTimeout(() => setShareState('idle'), 2000);
      } else {
        // Fallback: trigger a browser download
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShareState('done');
        setTimeout(() => setShareState('idle'), 2000);
      }
    } catch (err) {
      // User cancelled native share — not an error
      if (err.name === 'AbortError') {
        setShareState('idle');
        return;
      }
      console.error('Share error:', err);
      setShareError(err.message || 'Share failed');
      setShareState('error');
    }
  }

  const shareLabel = {
    idle:        '📤 Share / Download',
    downloading: `Downloading… ${progress > 0 ? progress + '%' : ''}`,
    sharing:     'Opening share sheet…',
    done:        '✓ Done!',
    error:       '⚠ Try again',
  }[shareState];

  const shareActive = shareState === 'downloading' || shareState === 'sharing';

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
            {file.name}
          </span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
              color: 'var(--ink-4)', padding: '4px 8px', minHeight: 44, lineHeight: 1 }}>×</button>
        </div>

        <div className="sheet-body">
          {/* File icon */}
          <div style={{
            width: 68, height: 68, borderRadius: 16, margin: '0 auto 18px',
            background: isPDF ? 'var(--red-bg)' : isImage ? 'var(--blue-bg)' : 'var(--sand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
          }}>
            {isPDF ? '📄' : isImage ? '🖼️' : '📁'}
          </div>

          {/* Meta rows */}
          {[
            { label: 'Name',     value: file.name },
            { label: 'Type',     value: isPDF ? 'PDF Document' : isImage ? 'Image' : file.mimeType },
            { label: 'Size',     value: formatSize(file.size) },
            { label: 'Saved on', value: formatDate(file.createdTime) },
          ].map(row => row.value ? (
            <div key={row.label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              padding: '11px 0', borderBottom: '1px solid var(--border-soft)',
            }}>
              <span style={{ fontSize: 13, color: 'var(--ink-4)', minWidth: 72 }}>{row.label}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 500,
                textAlign: 'right', maxWidth: '65%', wordBreak: 'break-all' }}>{row.value}</span>
            </div>
          ) : null)}

          {/* Download progress bar */}
          {shareState === 'downloading' && (
            <div style={{ marginTop: 16, marginBottom: -8 }}>
              <div style={{
                height: 4, background: 'var(--sand)', borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--accent)',
                  width: progress > 0 ? `${progress}%` : '30%',
                  transition: progress > 0 ? 'width .3s ease' : 'none',
                  animation: progress === 0 ? 'indeterminate 1.4s ease infinite' : 'none',
                }} />
              </div>
            </div>
          )}

          {shareError && (
            <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 12, textAlign: 'center' }}>
              {shareError}
            </p>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>

            {/* Share / Download — primary action */}
            <button
              onClick={handleShare}
              disabled={shareActive}
              style={{
                width: '100%', padding: '14px', borderRadius: 13,
                background: shareState === 'done' ? 'var(--green)' : shareActive ? 'var(--accent-light)' : 'var(--accent)',
                color: 'white', border: 'none', fontSize: 15, fontWeight: 700,
                cursor: shareActive ? 'default' : 'pointer',
                fontFamily: 'var(--font)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                minHeight: 52, WebkitTapHighlightColor: 'transparent',
                transition: 'background .2s',
              }}>
              {shareActive
                ? <><span className="spin" style={{ display: 'inline-block', width: 16, height: 16,
                    border: '2px solid rgba(255,255,255,.3)', borderTopColor: 'white', borderRadius: '50%' }} />
                    {shareLabel}</>
                : shareLabel
              }
            </button>

            {/* Open in Drive */}
            {file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '13px', borderRadius: 13,
                  border: '1.5px solid var(--border)', background: 'white',
                  color: 'var(--ink-2)', textDecoration: 'none', fontSize: 14,
                  fontFamily: 'var(--font)', fontWeight: 500, minHeight: 50,
                  WebkitTapHighlightColor: 'transparent',
                }}>
                Open in Google Drive ↗
              </a>
            )}

            <button onClick={onClose}
              style={{
                padding: '12px', borderRadius: 13, border: 'none', background: 'none',
                fontSize: 14, color: 'var(--ink-4)', cursor: 'pointer',
                fontFamily: 'var(--font)', minHeight: 44,
                WebkitTapHighlightColor: 'transparent',
              }}>
              Close
            </button>
          </div>

          {/* Explanation for desktop users */}
          {!canNativeShare && (
            <p style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center',
              marginTop: 8, lineHeight: 1.5 }}>
              On mobile, Share opens WhatsApp, Telegram, AirDrop and more.
              On desktop, the file is downloaded directly.
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes indeterminate {
          0%   { margin-left: -30%; width: 30%; }
          60%  { margin-left: 100%; width: 30%; }
          100% { margin-left: 100%; width: 30%; }
        }
      `}</style>
    </>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { auth, getAuthHeader } = useAuth();
  const navigate = useNavigate();

  const [files,   setFiles]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'folders' | 'recent'

  const fetchFiles = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const h = await getAuthHeader();
      const { data } = await axios.get(`${BASE}/drive/files`, { headers: { Authorization: h } });
      setFiles(data.files || []);
    } catch (err) {
      setError(err.response?.status === 401
        ? 'Session expired. Please sign in again.'
        : err.response?.data?.error || 'Could not load files.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const isFolder = f => f.mimeType === 'application/vnd.google-apps.folder';
  const allDocs    = files.filter(f => !isFolder(f));
  const allFolders = files.filter(f =>  isFolder(f));

  const searchLower = search.toLowerCase();
  const filteredDocs = allDocs.filter(f => f.name.toLowerCase().includes(searchLower));
  const filteredFolders = allFolders.filter(f => f.name.toLowerCase().includes(searchLower));

  // Recent = last 10 docs by createdTime
  const recentDocs = [...allDocs]
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    .slice(0, 10);

  const firstName = auth?.user?.name?.split(' ')[0] || 'My';

  return (
    <div className="page" style={{ background: 'var(--cream)' }}>
      <Navbar />

      <main style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* ── Greeting strip ── */}
        <div style={{
          padding: '20px 16px 16px',
          background: 'white',
          borderBottom: '1px solid var(--border-soft)',
        }}>
          <h1 style={{ fontSize: 'clamp(1.2rem, 5vw, 1.5rem)', marginBottom: 2 }}>
            {firstName}'s Vault
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {loading ? 'Loading…' : `${allDocs.length} document${allDocs.length !== 1 ? 's' : ''} · ${allFolders.length} folder${allFolders.length !== 1 ? 's' : ''}`}
          </p>

          {/* Search bar */}
          <div style={{ position: 'relative', marginTop: 14 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--ink-4)', pointerEvents: 'none' }}>🔍</span>
            <input
              className="input"
              type="search"
              placeholder="Search documents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 38, fontSize: 16 }}
            />
          </div>
        </div>

        {/* ── Tab bar ── */}
        {!loading && !error && files.length > 0 && (
          <div style={{
            display: 'flex', gap: 0,
            background: 'white',
            borderBottom: '1px solid var(--border-soft)',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',  /* Firefox */
            msOverflowStyle: 'none', /* IE */
          }}>
            {[
              { key: 'all',     label: `All (${allDocs.length})` },
              { key: 'folders', label: `Folders (${allFolders.length})` },
              { key: 'recent',  label: 'Recent' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1, padding: '12px 8px',
                  fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? 'var(--accent)' : 'var(--ink-3)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
                  whiteSpace: 'nowrap', fontFamily: 'var(--font)',
                  transition: 'color .15s',
                  minHeight: 44,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: '16px' }}>

          {/* ── Loading ── */}
          {loading && <Spinner />}

          {/* ── Error ── */}
          {!loading && error && (
            <div style={{
              background: 'var(--red-bg)', border: '1px solid #FFCDD2',
              borderRadius: 'var(--r-lg)', padding: '16px',
              color: 'var(--red)', fontSize: 13, marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <span>⚠ {error}</span>
              <button className="btn btn-ghost" onClick={fetchFiles}
                style={{ fontSize: 12, minHeight: 28, padding: '4px 10px', color: 'var(--red)', whiteSpace: 'nowrap' }}>
                Retry
              </button>
            </div>
          )}

          {/* ── Empty vault ── */}
          {!loading && !error && files.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 56, marginBottom: 16, opacity: .35 }}>🗄️</div>
              <h2 style={{ marginBottom: 10, fontSize: '1.1rem' }}>Your vault is empty</h2>
              <p style={{ color: 'var(--ink-3)', marginBottom: 28, fontSize: 14, lineHeight: 1.6 }}>
                Upload your first document and it will appear here, organised in your chosen folder.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/upload')}
                style={{ fontSize: 15, padding: '13px 24px' }}>
                Upload first document →
              </button>
            </div>
          )}

          {/* ── No search results ── */}
          {!loading && !error && files.length > 0 && search && filteredDocs.length === 0 && filteredFolders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--ink-4)' }}>
              <div style={{ fontSize: 36, marginBottom: 10, opacity: .4 }}>🔍</div>
              <p style={{ fontSize: 14 }}>No results for <strong>"{search}"</strong></p>
              <button className="btn btn-ghost" onClick={() => setSearch('')}
                style={{ marginTop: 12, color: 'var(--accent)' }}>Clear search</button>
            </div>
          )}

          {/* ── FOLDERS TAB ── */}
          {!loading && !error && activeTab === 'folders' && (
            <section>
              <p className="section-label">Folders in DocVault</p>
              {filteredFolders.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--ink-4)', textAlign: 'center', padding: '24px 0' }}>No folders yet.</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {filteredFolders.map(folder => {
                  const meta = getFolderMeta(folder.name);
                  return (
                    <a key={folder.id} href={folder.webViewLink} target="_blank" rel="noopener noreferrer"
                      style={{ textDecoration: 'none' }}>
                      <div className="card" style={{ padding: '14px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 38, height: 38, minWidth: 38, borderRadius: 10,
                          background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                        }}>{meta.icon}</div>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {folder.name}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── ALL / RECENT TAB ── */}
          {!loading && !error && (activeTab === 'all' || activeTab === 'recent') && (() => {
            const displayDocs = activeTab === 'recent' ? recentDocs
              : search ? filteredDocs : allDocs;

            if (displayDocs.length === 0 && !search) return (
              <p style={{ fontSize: 13, color: 'var(--ink-4)', textAlign: 'center', padding: '24px 0' }}>
                {activeTab === 'recent' ? 'No recent documents.' : 'No documents yet.'}
              </p>
            );

            return (
              <section>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <p className="section-label">
                    {activeTab === 'recent' ? 'Recently uploaded' : `Documents · ${displayDocs.length}`}
                  </p>
                  <button className="btn btn-ghost" onClick={fetchFiles}
                    style={{ fontSize: 12, padding: '4px 8px', minHeight: 28, color: 'var(--ink-4)' }}>
                    ↻ Refresh
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {displayDocs.map(file => {
                    const isPDF   = file.mimeType === 'application/pdf';
                    const isImage = file.mimeType?.startsWith('image/');
                    return (
                      <div key={file.id} className="card fade-in"
                        style={{ padding: '12px 12px', display: 'flex', alignItems: 'center', gap: 10 }}
                      >
                        {/* Icon — tapping opens detail sheet */}
                        <div
                          onClick={() => setSelectedDoc(file)}
                          style={{
                            width: 42, height: 42, minWidth: 42, borderRadius: 10,
                            background: isPDF ? 'var(--red-bg)' : isImage ? 'var(--blue-bg)' : 'var(--sand)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 20, cursor: 'pointer', flexShrink: 0,
                          }}>
                          {isPDF ? '📄' : isImage ? '🖼️' : '📁'}
                        </div>

                        {/* Info — tapping opens detail sheet */}
                        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                          onClick={() => setSelectedDoc(file)}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                            {file.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', gap: 8 }}>
                            {file.size && <span>{formatSize(file.size)}</span>}
                            {file.createdTime && <span>{formatDate(file.createdTime)}</span>}
                          </div>
                        </div>

                        {/* Share button — direct action, no sheet needed */}
                        <button
                          onClick={() => setSelectedDoc(file)}
                          style={{
                            flexShrink: 0,
                            padding: '7px 12px', borderRadius: 9,
                            background: 'var(--accent)', color: 'white',
                            border: 'none', cursor: 'pointer', fontSize: 12,
                            fontFamily: 'var(--font)', fontWeight: 600,
                            minHeight: 36, display: 'flex', alignItems: 'center', gap: 4,
                            WebkitTapHighlightColor: 'transparent',
                          }}>
                          ↑ Share
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* Bottom spacing for FAB */}
          <div style={{ height: 24 }} />
        </div>
      </main>

      {/* FAB — upload shortcut */}
      <button className="fab" onClick={() => navigate('/upload')} title="Upload document">
        ＋
      </button>

      {/* Document detail sheet */}
      {selectedDoc && (
        <DocSheet file={selectedDoc} getAuthHeader={getAuthHeader} onClose={() => setSelectedDoc(null)} />
      )}
    </div>
  );
}
