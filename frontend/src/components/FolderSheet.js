import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { BASE } from '../utils/api';

function Spinner({ size = 20 }) {
  return <span className="spin" style={{ display:'inline-block', width:size, height:size, border:'2px solid var(--sand)', borderTopColor:'var(--accent)', borderRadius:'50%' }} />;
}

export default function FolderSheet({ getAuthHeader, lastUsedFolderId, onSelect, onClose }) {
  const [folders,   setFolders]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [creating,  setCreating]  = useState(false);
  const [newName,   setNewName]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const searchRef = useRef();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const h = await getAuthHeader();
      const { data } = await axios.get(`${BASE}/drive/folders`, { headers: { Authorization: h } });
      setFolders(data.folders || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load folders. Check your connection.');
    } finally { setLoading(false); }
  }, [getAuthHeader]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) searchRef.current?.focus(); }, [loading]);

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const h = await getAuthHeader();
      const { data } = await axios.post(`${BASE}/drive/folders`, { folderPath: name }, { headers: { Authorization: h } });
      const f = data.folder;
      setFolders(prev => [...prev, { id: f.id, name: f.name, path: f.path }]);
      setNewName(''); setCreating(false);
      onSelect({ id: f.id, name: f.name, path: f.path });
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to create folder');
    } finally { setSaving(false); }
  }

  const sub = folders.filter(f => f.path !== '');
  const filtered = sub.filter(f =>
    f.path.toLowerCase().includes(search.toLowerCase()) ||
    f.name.toLowerCase().includes(search.toLowerCase())
  );
  const sorted = lastUsedFolderId
    ? [...filtered.filter(f => f.id === lastUsedFolderId), ...filtered.filter(f => f.id !== lastUsedFolderId)]
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
          <input ref={searchRef} className="input" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search folders…" style={{ marginBottom:10, fontSize:16 }} />

          {creating ? (
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Finance/Invoices" style={{ flex:1, fontSize:16 }}
                onKeyDown={e => e.key === 'Enter' && createFolder()} autoFocus />
              <button className="btn btn-primary" onClick={createFolder}
                disabled={!newName.trim() || saving} style={{ padding:'0 14px', minHeight:44 }}>
                {saving ? <Spinner size={14} /> : 'Create'}
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

        <div style={{ padding:'0 16px 32px', maxHeight:'55vh', overflowY:'auto', WebkitOverflowScrolling:'touch', scrollbarWidth:'none' }}>
          {loading && <div style={{ textAlign:'center', padding:'32px 0' }}><Spinner size={24} /></div>}
          {!loading && error && (
            <div style={{ color:'var(--red)', fontSize:13, padding:'12px 0' }}>
              ⚠ {error}
              <button className="btn btn-ghost" onClick={load} style={{ marginLeft:8, fontSize:12 }}>Retry</button>
            </div>
          )}
          {!loading && !error && sorted.length === 0 && (
            <p style={{ fontSize:13, color:'var(--ink-4)', textAlign:'center', padding:'24px 0' }}>
              {search ? `No folders match "${search}"` : 'No folders yet — create one above.'}
            </p>
          )}
          {!loading && !error && sorted.map(f => {
            const isLast = f.id === lastUsedFolderId;
            const depth  = (f.path.match(/\//g) || []).length;
            return (
              <button key={f.id} onClick={() => onSelect(f)} style={{
                width:'100%', textAlign:'left', padding:'11px 14px',
                display:'flex', alignItems:'center', gap:10,
                background: isLast ? 'var(--accent-bg)' : 'white',
                border:'1.5px solid ' + (isLast ? 'var(--accent)' : 'var(--border-soft)'),
                borderRadius:'var(--r)', marginBottom:6, cursor:'pointer', fontFamily:'var(--font)', minHeight:52,
              }}>
                <span style={{ fontSize:18, marginLeft: depth * 10 }}>📂</span>
                <span style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:13, fontWeight:500, color:'var(--ink-2)', display:'block',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize:11, color:'var(--ink-4)' }}>DocVault/{f.path}</span>
                </span>
                {isLast && <span style={{ fontSize:11, color:'var(--accent)', fontWeight:600, whiteSpace:'nowrap' }}>Last used</span>}
                <span style={{ color:'var(--ink-4)', fontSize:16 }}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
