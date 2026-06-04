/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import FolderSheet from '../components/FolderSheet';
import { BASE } from '../utils/api';
import {
  getSequentialName, confirmUsed, previewNames,
  sanitise, withExt, getExt,
} from '../utils/naming';
import { suggestName } from '../utils/aiNaming';

const MAX_FILES  = 10;
const AI_ENABLED = !!process.env.REACT_APP_ANTHROPIC_KEY;

// ─── tiny helpers ──────────────────────────────────────────────────────────────
let _uid = 0;
function uid() { return ++_uid + '_' + Math.random().toString(36).slice(2, 6); }

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function Spin({ s = 14, light = false }) {
  return (
    <span className="spin" style={{
      display: 'inline-block', width: s, height: s, borderRadius: '50%',
      border: `2px solid ${light ? 'rgba(255,255,255,.25)' : 'var(--sand)'}`,
      borderTopColor: light ? 'white' : 'var(--accent)',
    }} />
  );
}

// ─── Name tag ─────────────────────────────────────────────────────────────────
function NameTag({ source }) {
  if (source === 'ai')       return <span className="badge" style={{ background:'var(--purple-bg)', color:'var(--purple)', fontSize:10 }}>AI ✦</span>;
  if (source === 'custom')   return <span className="badge" style={{ background:'var(--blue-bg)',   color:'var(--blue)',   fontSize:10 }}>Custom</span>;
  return                            <span className="badge" style={{ background:'var(--sand)',       color:'var(--ink-4)', fontSize:10 }}>Auto</span>;
}

// ─── File card ─────────────────────────────────────────────────────────────────
function FileCard({ entry, result, seqIndex, onRemove, onPickFolder, onRename }) {
  const { file, resolvedName, folder, nameSource } = entry;
  const st      = result?.status;
  const isDone  = st === 'done';
  const isErr   = st === 'error';
  const isUp    = st === 'uploading';
  const isNaming = st === 'naming';

  const preview = file.type.startsWith('image/')
    ? URL.createObjectURL(file) : null;

  const displayName = resolvedName || file.name;

  return (
    <div style={{
      background: isDone ? '#f5fdf7' : 'white',
      border: `1.5px solid ${
        isDone ? '#a8d5b5'
        : isErr ? 'var(--red)'
        : (!folder && !isDone) ? '#e8a040'
        : 'var(--border-soft)'
      }`,
      borderRadius: 14,
      padding: '13px 12px',
      animation: 'fadeIn .2s ease',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>

        {/* Sequence badge */}
        <div style={{
          minWidth: 26, height: 26, borderRadius: '50%',
          background: isDone ? 'var(--green-bg)' : 'var(--sand)',
          color: isDone ? 'var(--green)' : 'var(--ink-4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, marginTop: 3, flexShrink: 0,
        }}>
          {isDone ? '✓' : seqIndex + 1}
        </div>

        {/* Thumb */}
        <div style={{
          width: 44, height: 44, minWidth: 44, borderRadius: 9,
          background: 'var(--paper)', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          {preview
            ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : file.type === 'application/pdf' ? '📄' : '📁'
          }
        </div>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Name row */}
          {isNaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <Spin s={11} />
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {AI_ENABLED ? 'AI naming…' : 'Preparing…'}
              </span>
            </div>
          ) : isUp ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <Spin s={11} />
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Uploading…</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 13, fontWeight: 500, color: 'var(--ink-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 'calc(100vw - 220px)',
              }}>
                {displayName}
              </span>
              {!isNaming && !isUp && <NameTag source={nameSource} />}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6 }}>
            {fmtSize(file.size)}
          </div>

          {/* Folder pill */}
          {!isDone && !isUp && !isNaming && (
            <button
              onClick={() => onPickFolder(entry)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 11px', borderRadius: 99,
                border: `1.5px solid ${folder ? 'var(--accent-light)' : '#e8a040'}`,
                background: folder ? 'var(--accent-bg)' : '#fff8ee',
                color: folder ? 'var(--accent)' : '#b07020',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'var(--font)',
                WebkitTapHighlightColor: 'transparent',
                maxWidth: '100%', overflow: 'hidden',
              }}>
              <span style={{ flexShrink: 0 }}>{folder ? '📂' : '⚠️'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {folder ? `DocVault/${folder.path}` : 'Choose folder'}
              </span>
              <span style={{ opacity: .5, flexShrink: 0 }}>›</span>
            </button>
          )}

          {/* Done */}
          {isDone && result.data && (
            <div style={{ animation: 'fadeIn .2s ease' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                📂 DocVault/{result.data.file.folderPath || folder?.path}
              </div>
              {result.data.file.viewLink && (
                <a
                  href={result.data.file.viewLink}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                  Open in Drive ↗
                </a>
              )}
            </div>
          )}

          {/* Error */}
          {isErr && (
            <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
              ⚠ {result.error}
            </p>
          )}
        </div>

        {/* Action buttons — only when idle */}
        {!isUp && !isNaming && !isDone && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => onRename(entry)}
              aria-label="Rename"
              style={{
                width: 36, height: 36, borderRadius: 8,
                border: '1px solid var(--border-soft)', background: 'var(--paper)',
                cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}>✏️</button>
            <button
              onClick={() => onRemove(entry.id)}
              aria-label="Remove"
              style={{
                width: 36, height: 36, borderRadius: 8,
                border: '1px solid var(--border-soft)', background: 'var(--paper)',
                cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}>🗑️</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Rename sheet ──────────────────────────────────────────────────────────────
function RenameSheet({ entry, onSave, onClose }) {
  const [val, setVal] = useState(
    (entry.resolvedName || entry.file.name).replace(/\.[^.]+$/, '')
  );
  const ref = useRef();
  useEffect(() => { setTimeout(() => ref.current?.focus(), 80); }, []);

  function save() {
    const name = sanitise(val.trim() || entry.file.name.replace(/\.[^.]+$/, ''));
    onSave(withExt(name, entry.file.name));
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>Rename file</span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ink-4)', padding: '4px 8px', minHeight: 44, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '14px 20px 32px' }}>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 10 }}>
            Extension is kept automatically.
          </p>
          <input
            ref={ref}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="e.g. AadhaarCard or Payslip_Mar2025"
            style={{
              width: '100%', padding: '13px 14px', marginBottom: 14,
              border: '1.5px solid var(--border)', borderRadius: 10,
              fontFamily: 'var(--font)', fontSize: 16,
              outline: 'none', background: 'white', color: 'var(--ink)',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={save}
              style={{
                flex: 1, padding: '14px', borderRadius: 12,
                background: 'var(--accent)', color: 'white', border: 'none',
                fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
                minHeight: 50, WebkitTapHighlightColor: 'transparent',
              }}>Save</button>
            <button onClick={onClose}
              style={{
                flex: 1, padding: '14px', borderRadius: 12,
                background: 'white', color: 'var(--ink-2)',
                border: '1.5px solid var(--border)',
                fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)',
                minHeight: 50, WebkitTapHighlightColor: 'transparent',
              }}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Naming info sheet ─────────────────────────────────────────────────────────
function NamingSheet({ folder, onClose }) {
  const previews = previewNames(folder?.path || null, '.pdf', 4);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>Naming rules</span>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--ink-4)', padding: '4px 8px', minHeight: 44, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 20px 36px' }}>

          {/* Priority ladder */}
          {[
            { n: 1, label: 'Your custom name',   desc: 'Tap ✏️ on any file before uploading', c: 'var(--blue)',   bg: 'var(--blue-bg)' },
            { n: 2, label: 'AI suggestion',       desc: AI_ENABLED
                ? 'Claude reads the file and suggests a name'
                : 'Disabled — add REACT_APP_ANTHROPIC_KEY to frontend/.env',
              c: 'var(--purple)', bg: 'var(--purple-bg)', dim: !AI_ENABLED },
            { n: 3, label: 'Sequential (always)', desc: 'FolderName_001, FolderName_002 … never fails', c: 'var(--green)', bg: 'var(--green-bg)' },
          ].map(row => (
            <div key={row.n}
              style={{ display: 'flex', gap: 12, marginBottom: 16, opacity: row.dim ? 0.4 : 1 }}>
              <div style={{
                width: 28, height: 28, minWidth: 28, borderRadius: '50%',
                background: row.bg, color: row.c,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
              }}>{row.n}</div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, color: 'var(--ink)' }}>{row.label}</p>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{row.desc}</p>
              </div>
            </div>
          ))}

          {/* Next-names preview */}
          <div style={{ background: 'var(--paper)', borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Next names — {folder ? `DocVault/${folder.path}` : 'no folder selected'}
            </p>
            {previews.map((n, i) => (
              <div key={i} style={{
                fontSize: 13, color: 'var(--ink-2)', padding: '5px 0',
                borderBottom: i < previews.length - 1 ? '1px solid var(--border-soft)' : 'none',
                fontFamily: 'var(--mono)',
              }}>{n}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const { getAuthHeader } = useAuth();
  const navigate          = useNavigate();
  const fileInputRef      = useRef();

  const [entries,      setEntries]      = useState([]);
  const [results,      setResults]      = useState({});
  const [isUploading,  setIsUploading]  = useState(false);
  const [folderTarget, setFolderTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [showNaming,   setShowNaming]   = useState(false);
  const [lastFolder,   setLastFolder]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('dv_last_folder')) || null; }
    catch { return null; }
  });

  // ── Add files ──────────────────────────────────────────────────────────────
  const addFiles = useCallback(async (fileList) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/heic','application/pdf'];
    const incoming = Array.from(fileList)
      .filter(f => allowed.includes(f.type))
      .slice(0, MAX_FILES - entries.length);

    if (!incoming.length) return;

    const currentEntries = entries;
    const folder         = lastFolder;

    // Build skeleton entries first (shows immediately in list)
    const skeletons = incoming.map(f => ({
      id:           uid(),
      file:         f,
      resolvedName: null,
      nameSource:   null,
      folder:       folder || null,
    }));

    setEntries(prev => [...prev, ...skeletons]);
    const initResults = {};
    skeletons.forEach(s => { initResults[s.id] = { status: 'naming' }; });
    setResults(prev => ({ ...prev, ...initResults }));

    // Resolve name for each file. Use offset to avoid sequential collisions.
    for (let i = 0; i < skeletons.length; i++) {
      const skeleton = skeletons[i];
      const fileExt  = getExt(skeleton.file.name);

      // Count how many entries for this folder are already queued ahead
      const allForFolder = [
        ...currentEntries.filter(e => e.folder?.path === folder?.path && e.nameSource === 'sequential'),
        ...skeletons.slice(0, i).filter(e => e.folder?.path === folder?.path),
      ];
      const offset = allForFolder.length;

      let finalName, nameSource;
      try {
        // 1. Try AI (optional, non-blocking, never throws)
        let aiName = null;
        if (AI_ENABLED) {
          aiName = await suggestName(skeleton.file, folder?.path || null);
        }

        if (aiName) {
          finalName  = sanitise(aiName) + fileExt;
          nameSource = 'ai';
        } else {
          // 2. Sequential — always works
          finalName  = getSequentialName(folder?.path || null, fileExt, offset);
          nameSource = 'sequential';
        }
      } catch {
        // Ultimate fallback — should never reach here, but just in case
        finalName  = getSequentialName(folder?.path || null, fileExt, offset);
        nameSource = 'sequential';
      }

      setEntries(prev => prev.map(e =>
        e.id === skeleton.id ? { ...e, resolvedName: finalName, nameSource } : e
      ));
      setResults(prev => {
        if (prev[skeleton.id]?.status === 'naming') {
          const { [skeleton.id]: _, ...rest } = prev;
          return rest;
        }
        return prev;
      });
    }
  }, [entries, lastFolder]);

  function onFileInput(e) { addFiles(e.target.files); e.target.value = ''; }

  function removeEntry(id) {
    setEntries(prev => prev.filter(e => e.id !== id));
    setResults(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  function assignFolder(entry, folder) {
    setLastFolder(folder);
    localStorage.setItem('dv_last_folder', JSON.stringify(folder));

    setEntries(prev => prev.map(e => {
      if (e.id !== entry.id) return e;
      // Recalculate sequential name with new folder prefix
      if (e.nameSource !== 'custom' && e.nameSource !== 'ai') {
        const offset = prev.filter(
          x => x.id !== e.id && x.folder?.path === folder.path && x.nameSource === 'sequential'
        ).length;
        const newName = getSequentialName(folder.path, getExt(e.file.name), offset);
        return { ...e, folder, resolvedName: newName, nameSource: 'sequential' };
      }
      return { ...e, folder };
    }));
    setFolderTarget(null);
  }

  function applyRename(newName) {
    setEntries(prev => prev.map(e =>
      e.id === renameTarget.id
        ? { ...e, resolvedName: newName, nameSource: 'custom' }
        : e
    ));
    setRenameTarget(null);
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function uploadAll() {
    const pending = entries.filter(e => {
      const s = results[e.id]?.status;
      return e.folder && s !== 'done' && s !== 'uploading' && s !== 'naming';
    });
    if (!pending.length) return;
    setIsUploading(true);

    for (const entry of pending) {
      setResults(prev => ({ ...prev, [entry.id]: { status: 'uploading' } }));
      try {
        const h    = await getAuthHeader();
        const name = entry.resolvedName
          || getSequentialName(entry.folder.path, getExt(entry.file.name));

        const form = new FormData();
        form.append('document',   entry.file);
        form.append('customName', name);
        form.append('folderId',   entry.folder.id);
        form.append('folderPath', entry.folder.path);

        const { data } = await axios.post(`${BASE}/upload`, form, {
          headers: { Authorization: h, 'Content-Type': 'multipart/form-data' },
        });

        // Increment counter only after success, and only for sequential names
        if (entry.nameSource === 'sequential') {
          confirmUsed(entry.folder.path);
        }

        setResults(prev => ({ ...prev, [entry.id]: { status: 'done', data } }));
      } catch (err) {
        setResults(prev => ({
          ...prev,
          [entry.id]: { status: 'error', error: err.response?.data?.error || err.message },
        }));
      }
    }
    setIsUploading(false);
  }

  // ── Derived counts ─────────────────────────────────────────────────────────
  const namingCount   = entries.filter(e => results[e.id]?.status === 'naming').length;
  const noFolderCount = entries.filter(e => !e.folder && !['done','uploading','naming'].includes(results[e.id]?.status)).length;
  const pendingCount  = entries.filter(e => {
    const s = results[e.id]?.status;
    return e.folder && s !== 'done' && s !== 'uploading' && s !== 'naming';
  }).length;
  const doneCount     = entries.filter(e => results[e.id]?.status === 'done').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', paddingBottom: 'calc(var(--bottom-bar-h) + 80px)' }}>
      <Navbar />

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '18px 16px 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', marginBottom: 2 }}>Upload</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              Files get sequential names automatically.
            </p>
          </div>
          <button
            onClick={() => setShowNaming(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '8px 13px', borderRadius: 99,
              border: '1px solid var(--border)', background: 'white',
              cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)',
              fontFamily: 'var(--font)', minHeight: 44,
              WebkitTapHighlightColor: 'transparent',
            }}>
            ⚙️ Naming
          </button>
        </div>

        {/* Pick zone */}
        <div
          onClick={() => !isUploading && entries.length < MAX_FILES && fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${entries.length >= MAX_FILES ? 'var(--border-soft)' : 'var(--accent-light)'}`,
            borderRadius: 16, padding: '26px 16px', textAlign: 'center',
            background: 'white', marginBottom: 14,
            cursor: entries.length >= MAX_FILES || isUploading ? 'default' : 'pointer',
            opacity: entries.length >= MAX_FILES ? 0.5 : 1,
            WebkitTapHighlightColor: 'transparent',
          }}>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={onFileInput} />
          <div style={{ fontSize: 28, marginBottom: 6 }}>☁️</div>
          <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-2)', marginBottom: 3 }}>
            {entries.length >= MAX_FILES ? `Max ${MAX_FILES} files reached` : 'Tap to choose files'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>
            JPG · PNG · WEBP · PDF · Max 20 MB
          </p>
          {AI_ENABLED && (
            <p style={{ fontSize: 11, color: 'var(--purple)', marginTop: 6, fontWeight: 500 }}>
              ✦ AI naming active
            </p>
          )}
        </div>

        {/* Last folder hint */}
        {lastFolder && entries.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
            📂 New files will go to <strong>DocVault/{lastFolder.path}</strong>
          </p>
        )}

        {/* Naming spinner */}
        {namingCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 13px', background: 'var(--purple-bg)',
            borderRadius: 9, marginBottom: 12, fontSize: 13, color: 'var(--purple)',
          }}>
            <Spin s={12} />
            Naming {namingCount} file{namingCount > 1 ? 's' : ''}…
          </div>
        )}

        {/* File list */}
        {entries.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {entries.length} file{entries.length !== 1 ? 's' : ''}
              </span>
              {!isUploading && (
                <button
                  onClick={() => { setEntries([]); setResults({}); }}
                  style={{ fontSize: 12, color: 'var(--ink-4)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', minHeight: 36, fontFamily: 'var(--font)' }}>
                  Clear all
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {entries.map((entry, i) => (
                <FileCard
                  key={entry.id}
                  entry={entry}
                  result={results[entry.id]}
                  seqIndex={i}
                  onRemove={removeEntry}
                  onPickFolder={setFolderTarget}
                  onRename={setRenameTarget}
                />
              ))}
            </div>
          </>
        )}

        {/* No-folder warning */}
        {noFolderCount > 0 && (
          <div style={{
            background: '#fff8ee', border: '1px solid #f0cc82',
            borderRadius: 10, padding: '11px 14px',
            fontSize: 13, color: '#9a6010', marginBottom: 12,
          }}>
            ⚠️ {noFolderCount} file{noFolderCount !== 1 ? 's' : ''} need{noFolderCount === 1 ? 's' : ''} a folder — tap the orange pill.
          </div>
        )}

        {/* Done */}
        {doneCount > 0 && (
          <div style={{
            background: 'var(--green-bg)', border: '1px solid #a8d5b5',
            borderRadius: 10, padding: '11px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>
              ✅ {doneCount} saved to Drive
            </span>
            <button
              onClick={() => navigate('/dashboard')}
              style={{ fontSize: 13, color: 'var(--green)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)', padding: '4px 8px', fontWeight: 500 }}>
              View →
            </button>
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-4)' }}>
            <div style={{ fontSize: 40, marginBottom: 8, opacity: .2 }}>📄</div>
            <p style={{ fontSize: 13 }}>No files yet.</p>
          </div>
        )}
      </div>

      {/* ── Sticky upload bar ── */}
      {pendingCount > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 'var(--bottom-bar-h)',
          left: 0, right: 0,
          padding: '10px 16px max(env(safe-area-inset-bottom), 12px)',
          background: 'white',
          borderTop: '1px solid var(--border-soft)',
          zIndex: 90,
          boxShadow: '0 -4px 20px rgba(0,0,0,.07)',
        }}>
          <button
            onClick={uploadAll}
            disabled={isUploading}
            style={{
              width: '100%', padding: '15px',
              borderRadius: 14,
              background: isUploading ? 'var(--accent-light)' : 'var(--accent)',
              color: 'white', border: 'none',
              cursor: isUploading ? 'default' : 'pointer',
              fontSize: 15, fontWeight: 700, fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              minHeight: 54, WebkitTapHighlightColor: 'transparent',
            }}>
            {isUploading
              ? <><Spin s={16} light /> Uploading…</>
              : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''} →`
            }
          </button>
        </div>
      )}

      {/* ── Sheets ── */}
      {folderTarget && (
        <FolderSheet
          getAuthHeader={getAuthHeader}
          lastUsedFolderId={lastFolder?.id}
          onSelect={f => assignFolder(folderTarget, f)}
          onClose={() => setFolderTarget(null)}
        />
      )}
      {renameTarget && (
        <RenameSheet
          entry={renameTarget}
          onSave={applyRename}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {showNaming && (
        <NamingSheet folder={lastFolder} onClose={() => setShowNaming(false)} />
      )}
    </div>
  );
}
