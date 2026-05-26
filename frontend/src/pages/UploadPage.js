import React, { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import { BASE } from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';

const MAX_FILES = 8;

// ─── tiny helpers ──────────────────────────────────────────────────────────────
function formatSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function Spinner({ size = 16, color = 'var(--accent)' }) {
  return <span className="spin" style={{ display:'inline-block', width:size, height:size, border:`2px solid var(--sand)`, borderTopColor:color, borderRadius:'50%' }} />;
}

// ─── Folder Picker Sheet ───────────────────────────────────────────────────────
function FolderSheet({ tokens, getAuthHeader, lastUsedFolderId, onSelect, onClose }) {
  const [folders, setFolders]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error,   setError]           = useState('');
  const [search,  setSearch]          = useState('');
  const [creating, setCreating]       = useState(false);
  const [newName,  setNewName]        = useState('');
  const [creating2, setCreating2]     = useState(false); // spinner while API call
  const searchRef = useRef();

  useEffect(() => { fetchFolders(); }, []);
  useEffect(() => { searchRef.current?.focus(); }, [loading]);

  async function fetchFolders() {
    setLoading(true); setError('');
    try {
      const h = await getAuthHeader();
      const { data } = await axios.get(`${BASE}/drive/folders`, { headers: { Authorization: h } });
      setFolders(data.folders || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load folders');
    } finally { setLoading(false); }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating2(true);
    try {
      const h = await getAuthHeader();
      const { data } = await axios.post(`${BASE}/drive/folders`, { folderPath: name }, { headers: { Authorization: h } });
      const f = data.folder;
      setFolders(prev => [...prev, { id: f.id, name: f.name, path: f.path }]);
      setNewName(''); setCreating(false);
      onSelect({ id: f.id, name: f.name, path: f.path });
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to create folder');
    } finally { setCreating2(false); }
  }

  // filter — skip the root DocVault entry (path:'') in the list; show it separately
  const subFolders = folders.filter(f => f.path !== '');
  const filtered = subFolders.filter(f =>
    f.path.toLowerCase().includes(search.toLowerCase()) ||
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  // put last-used folder at the top
  const sorted = lastUsedFolderId
    ? [
        ...filtered.filter(f => f.id === lastUsedFolderId),
        ...filtered.filter(f => f.id !== lastUsedFolderId),
      ]
    : filtered;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight:600, fontSize:15 }}>Choose folder</span>
          <button className="btn btn-ghost" onClick={onClose}
            style={{ padding:'4px 8px', fontSize:20, minHeight:32, color:'var(--ink-4)' }}>×</button>
        </div>

        <div style={{ padding:'12px 16px 0' }}>
          {/* Search */}
          <input
            ref={searchRef}
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search folders…"
            style={{ marginBottom:10 }}
          />

          {/* New folder toggle */}
          {creating ? (
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <input
                className="input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Identity/Aadhaar or Work/Contracts"
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                autoFocus
                style={{ flex:1 }}
              />
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim() || creating2}
                style={{ padding:'0 14px', minHeight:44, whiteSpace:'nowrap' }}>
                {creating2 ? <Spinner size={14} color="white" /> : 'Create'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setCreating(false); setNewName(''); }}
                style={{ padding:'0 10px', minHeight:44 }}>✕</button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-full" onClick={() => setCreating(true)}
              style={{ marginBottom:10, fontSize:13 }}>
              ＋ Create new folder
            </button>
          )}
        </div>

        {/* List */}
        <div style={{ padding:'0 16px 24px', maxHeight:'55vh', overflowY:'auto' }}>
          {loading && (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <Spinner size={24} /> <p style={{ marginTop:10, fontSize:13, color:'var(--ink-4)' }}>Loading folders…</p>
            </div>
          )}
          {!loading && error && (
            <div style={{ color:'var(--red)', fontSize:13, padding:'12px 0' }}>⚠ {error}
              <button className="btn btn-ghost" onClick={fetchFolders} style={{ marginLeft:8, fontSize:12 }}>Retry</button>
            </div>
          )}
          {!loading && !error && sorted.length === 0 && !search && (
            <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center', padding:'24px 0' }}>
              No sub-folders yet. Create one above.
            </p>
          )}
          {!loading && !error && sorted.length === 0 && search && (
            <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center', padding:'24px 0' }}>
              No folders match "{search}"
            </p>
          )}
          {!loading && !error && sorted.map(f => {
            const isLast = f.id === lastUsedFolderId;
            const depth = (f.path.match(/\//g) || []).length;
            return (
              <button key={f.id} onClick={() => onSelect(f)}
                style={{
                  width:'100%', textAlign:'left',
                  padding:'11px 14px',
                  display:'flex', alignItems:'center', gap:10,
                  background: isLast ? 'var(--accent-bg)' : 'white',
                  border:'1.5px solid ' + (isLast ? 'var(--accent)' : 'var(--border-soft)'),
                  borderRadius:'var(--r)', marginBottom:6, cursor:'pointer',
                  fontFamily:'var(--font)',
                }}>
                <span style={{ fontSize:18, marginLeft: depth * 8 }}>📂</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:14, fontWeight:500, color:'var(--ink-2)', display:'block',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {f.name}
                  </span>
                  <span style={{ fontSize:11, color:'var(--ink-4)' }}>DocVault/{f.path}</span>
                </span>
                {isLast && <span style={{ fontSize:11, color:'var(--accent)', whiteSpace:'nowrap', fontWeight:600 }}>Last used</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── File card ─────────────────────────────────────────────────────────────────
function FileCard({ entry, result, onRemove, onPickFolder, onRename, isProcessing }) {
  const { file, customName, folder } = entry;
  const isUploading = result?.status === 'uploading';
  const isDone      = result?.status === 'done';
  const isError     = result?.status === 'error';

  const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  const displayName = customName || file.name;

  return (
    <div className="card fade-in" style={{
      padding:'13px 13px',
      borderColor: isDone ? '#C8E6C9' : isError ? '#FFCDD2' : !folder ? 'var(--amber)' : undefined,
      background: isDone ? '#FAFFFE' : 'white',
    }}>
      <div style={{ display:'flex', gap:11, alignItems:'flex-start' }}>
        {/* Thumb */}
        <div style={{
          width:46, height:46, minWidth:46, borderRadius:10,
          background:'var(--sand)', overflow:'hidden',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:20,
        }}>
          {preview
            ? <img src={preview} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : file.type === 'application/pdf' ? '📄' : '📁'
          }
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          {/* Name row */}
          <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>
            {displayName}
          </div>
          <div style={{ fontSize:11, color:'var(--ink-4)', marginBottom:6 }}>{formatSize(file.size)}</div>

          {/* Folder pill / picker */}
          {!isDone && !isUploading && (
            <button onClick={() => onPickFolder(entry)}
              style={{
                display:'inline-flex', alignItems:'center', gap:5,
                padding:'5px 10px', borderRadius:99,
                border:'1.5px solid ' + (folder ? 'var(--accent-light)' : 'var(--amber)'),
                background: folder ? 'var(--accent-bg)' : 'var(--amber-bg)',
                color: folder ? 'var(--accent)' : 'var(--amber)',
                fontSize:12, fontWeight:500, cursor:'pointer',
                fontFamily:'var(--font)', maxWidth:'100%',
              }}>
              <span>{folder ? '📂' : '⚠️'}</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:180 }}>
                {folder ? `DocVault/${folder.path}` : 'Tap to choose folder'}
              </span>
              <span style={{ marginLeft:2, opacity:.6 }}>›</span>
            </button>
          )}

          {/* Uploading status */}
          {isUploading && (
            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4 }}>
              <Spinner size={12} />
              <span style={{ fontSize:12, color:'var(--ink-3)' }}>Uploading to Drive…</span>
            </div>
          )}

          {/* Done */}
          {isDone && result.data && (
            <div style={{ animation:'fadeIn .2s ease', marginTop:4 }}>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:4 }}>
                <span className="badge badge-green">✓ Saved</span>
                <span className="badge badge-accent" style={{ maxWidth:200, overflow:'hidden', textOverflow:'ellipsis' }}>
                  📂 DocVault/{result.data.file.folderPath || ''}
                </span>
              </div>
              {result.data.file.viewLink && (
                <a href={result.data.file.viewLink} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize:12, color:'var(--accent)', textDecoration:'underline' }}>
                  Open in Drive ↗
                </a>
              )}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div style={{ marginTop:4, fontSize:12, color:'var(--red)' }}>⚠ {result.error}</div>
          )}
        </div>

        {/* Actions */}
        {!isUploading && !isDone && (
          <div style={{ display:'flex', gap:4 }}>
            <button className="btn btn-ghost" onClick={() => onRename(entry)}
              style={{ padding:'4px 7px', fontSize:14, minHeight:32, color:'var(--ink-3)' }} title="Rename">✏️</button>
            <button className="btn btn-ghost" onClick={() => onRemove(file.name)}
              style={{ padding:'4px 7px', fontSize:14, minHeight:32, color:'var(--ink-4)' }} title="Remove">🗑️</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Rename sheet ──────────────────────────────────────────────────────────────
function RenameSheet({ entry, onSave, onClose }) {
  const [name, setName] = useState(entry.customName || entry.file.name);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight:600, fontSize:15 }}>Rename file</span>
          <button className="btn btn-ghost" onClick={onClose}
            style={{ padding:'4px 8px', fontSize:20, minHeight:32, color:'var(--ink-4)' }}>×</button>
        </div>
        <div className="sheet-body">
          <input className="input" value={name} onChange={e => setName(e.target.value)}
            placeholder={entry.file.name} autoFocus
            onKeyDown={e => e.key === 'Enter' && onSave(name.trim() || entry.file.name)}
            style={{ marginBottom:16 }}
          />
          <button className="btn btn-primary btn-full" style={{ fontSize:15, padding:'13px' }}
            onClick={() => onSave(name.trim() || entry.file.name)}>
            Save name
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const { getAuthHeader } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef();

  const [entries,      setEntries]      = useState([]);
  const [results,      setResults]      = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [folderTarget, setFolderTarget] = useState(null); // entry being assigned folder
  const [renameTarget, setRenameTarget] = useState(null);
  const [lastFolder,   setLastFolder]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')) || null; } catch { return null; }
  });

  function addFiles(incoming) {
    const fresh = incoming
      .filter(f => !entries.find(e => e.file.name === f.name))
      .slice(0, MAX_FILES - entries.length)
      .map(f => ({ file: f, customName: f.name, folder: lastFolder || null }));
    setEntries(prev => [...prev, ...fresh]);
  }

  function onFileInput(e) {
    addFiles(Array.from(e.target.files || []));
    e.target.value = '';
  }

  const onDrop = useCallback(e => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  }, [entries.length, lastFolder]);

  function removeEntry(name) {
    setEntries(prev => prev.filter(e => e.file.name !== name));
    setResults(prev => { const n = { ...prev }; delete n[name]; return n; });
  }

  function assignFolder(entry, folder) {
    setLastFolder(folder);
    localStorage.setItem('dv_last_folder', JSON.stringify(folder));
    setEntries(prev => prev.map(e => e.file.name === entry.file.name ? { ...e, folder } : e));
    setFolderTarget(null);
  }

  function saveRename(newName) {
    setEntries(prev => prev.map(e => e.file.name === renameTarget.file.name ? { ...e, customName: newName } : e));
    setRenameTarget(null);
  }

  async function uploadAll() {
    const pending = entries.filter(e => e.folder && (!results[e.file.name] || results[e.file.name].status === 'error'));
    if (!pending.length) return;
    setIsProcessing(true);

    for (const entry of pending) {
      const key = entry.file.name;
      setResults(prev => ({ ...prev, [key]: { status: 'uploading' } }));
      try {
        const h = await getAuthHeader();
        const form = new FormData();
        form.append('document', entry.file);
        form.append('folderId',  entry.folder.id);
        form.append('folderPath', entry.folder.path);
        if (entry.customName && entry.customName !== entry.file.name) {
          form.append('customName', entry.customName);
        }
        const { data } = await axios.post(`${BASE}/upload`, form, {
          headers: { Authorization: h, 'Content-Type': 'multipart/form-data' },
        });
        setResults(prev => ({ ...prev, [key]: { status: 'done', data } }));
      } catch (err) {
        setResults(prev => ({ ...prev, [key]: { status: 'error', error: err.response?.data?.error || err.message } }));
      }
    }
    setIsProcessing(false);
  }

  const pendingCount = entries.filter(e => e.folder && (!results[e.file.name] || results[e.file.name].status === 'error')).length;
  const noFolderCount = entries.filter(e => !e.folder && !results[e.file.name]?.status).length;
  const doneCount = entries.filter(e => results[e.file.name]?.status === 'done').length;

  return (
    <div className="page" style={{ background:'var(--cream)' }}>
      <Navbar />

      <main style={{ maxWidth:680, margin:'0 auto' }}>
        <div style={{ padding:'20px 16px 0' }}>
          <h1 style={{ marginBottom:4 }}>Upload Documents</h1>
          <p style={{ fontSize:13, color:'var(--ink-3)', marginBottom:16 }}>
            Pick files, choose a Drive folder, then upload.
          </p>

          {/* Drop zone */}
          <div
            onDrop={onDrop} onDragOver={e => e.preventDefault()}
            onClick={() => !isProcessing && entries.length < MAX_FILES && fileInputRef.current?.click()}
            style={{
              border:`2px dashed var(--border)`, borderRadius:'var(--r-lg)',
              padding:'28px 16px', textAlign:'center', background:'white',
              cursor: entries.length >= MAX_FILES || isProcessing ? 'not-allowed' : 'pointer',
              opacity: entries.length >= MAX_FILES ? 0.5 : 1,
              marginBottom:16,
            }}
          >
            <input ref={fileInputRef} type="file" multiple style={{ display:'none' }}
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={onFileInput} />
            <div style={{ fontSize:32, marginBottom:8 }}>☁️</div>
            <p style={{ fontWeight:500, fontSize:14, color:'var(--ink-2)', marginBottom:3 }}>Tap to pick files</p>
            <p style={{ fontSize:12, color:'var(--ink-4)' }}>JPG · PNG · WEBP · HEIC · PDF · Max 20 MB</p>
          </div>

          {/* Last used folder hint */}
          {lastFolder && entries.length === 0 && (
            <div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
              <span>📂</span>
              <span>New files will default to <strong>DocVault/{lastFolder.path}</strong></span>
            </div>
          )}
        </div>

        <div style={{ padding:'0 16px' }}>
          {/* File list */}
          {entries.length > 0 && (
            <>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <span className="section-label">{entries.length} file{entries.length !== 1 ? 's' : ''}</span>
                {!isProcessing && (
                  <button className="btn btn-ghost" onClick={() => { setEntries([]); setResults({}); }}
                    style={{ fontSize:12, padding:'4px 10px', minHeight:28, color:'var(--ink-4)' }}>
                    Clear all
                  </button>
                )}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:16 }}>
                {entries.map(entry => (
                  <FileCard key={entry.file.name} entry={entry} result={results[entry.file.name]}
                    onRemove={removeEntry} onPickFolder={e => setFolderTarget(e)}
                    onRename={e => setRenameTarget(e)} isProcessing={isProcessing} />
                ))}
              </div>
            </>
          )}

          {/* No-folder warning */}
          {noFolderCount > 0 && (
            <div style={{
              background:'var(--amber-bg)', border:'1px solid #F0CC82',
              borderRadius:'var(--r)', padding:'10px 14px',
              fontSize:12, color:'var(--amber)', marginBottom:12,
            }}>
              ⚠️ {noFolderCount} file{noFolderCount !== 1 ? 's' : ''} need{noFolderCount === 1 ? 's' : ''} a folder — tap the orange pill to assign one.
            </div>
          )}

          {/* Done */}
          {doneCount > 0 && (
            <div style={{
              background:'var(--green-bg)', border:'1px solid #C8E6C9',
              borderRadius:'var(--r)', padding:'10px 14px',
              fontSize:13, color:'var(--green)', marginBottom:12,
              display:'flex', alignItems:'center', justifyContent:'space-between',
            }}>
              <span>✅ {doneCount} file{doneCount !== 1 ? 's' : ''} saved to Drive!</span>
              <button className="btn btn-ghost" onClick={() => navigate('/dashboard')}
                style={{ fontSize:12, color:'var(--green)', padding:'4px 8px', minHeight:28 }}>
                View →
              </button>
            </div>
          )}

          {/* Empty */}
          {entries.length === 0 && (
            <div style={{ textAlign:'center', padding:'24px 0', color:'var(--ink-4)' }}>
              <div style={{ fontSize:40, marginBottom:8, opacity:.3 }}>📄</div>
              <p style={{ fontSize:13 }}>No files selected.</p>
            </div>
          )}
        </div>
      </main>

      {/* Sticky upload button */}
      {pendingCount > 0 && (
        <div style={{
          position:'fixed', bottom:'var(--bottom-bar-h)', left:0, right:0,
          padding:'10px 16px', background:'white',
          borderTop:'1px solid var(--border-soft)', zIndex:90,
        }}>
          <button className="btn btn-primary btn-full" onClick={uploadAll} disabled={isProcessing}
            style={{ fontSize:15, padding:'13px' }}>
            {isProcessing
              ? <><Spinner size={14} color="white" /> Uploading…</>
              : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''} to Drive →`
            }
          </button>
        </div>
      )}

      {/* Folder picker sheet */}
      {folderTarget && (
        <FolderSheet
          getAuthHeader={getAuthHeader}
          lastUsedFolderId={lastFolder?.id}
          onSelect={f => assignFolder(folderTarget, f)}
          onClose={() => setFolderTarget(null)}
        />
      )}

      {/* Rename sheet */}
      {renameTarget && (
        <RenameSheet entry={renameTarget} onSave={saveRename} onClose={() => setRenameTarget(null)} />
      )}
    </div>
  );
}
