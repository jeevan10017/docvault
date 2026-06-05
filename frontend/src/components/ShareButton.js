import React, { useState } from 'react';
import { BASE } from '../utils/api';

async function doShare(file, getAuthHeader, onProgress) {
  const authHeader = await getAuthHeader();
  const url = `${BASE}/drive/file/${file.id}/download?filename=${encodeURIComponent(file.name)}`;

  const response = await fetch(url, { headers: { Authorization: authHeader } });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `Download failed (${response.status})`);
  }

  const contentLength = parseInt(response.headers.get('Content-Length') || file.size || '0');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0 && onProgress) {
      onProgress(Math.round((received / contentLength) * 100));
    }
  }

  const blob     = new Blob(chunks, { type: file.mimeType || 'application/octet-stream' });
  const fileObj  = new File([blob], file.name, { type: blob.type });
  const canShare = typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [fileObj] });

  if (canShare) {
    await navigator.share({ files: [fileObj], title: file.name });
  } else {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = file.name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * ShareButton — downloads the file from Drive and shares/downloads it.
 *
 * Props:
 *   file          { id, name, mimeType, size }
 *   getAuthHeader async fn → auth header string
 *   variant       'pill' (compact, for list rows) | 'full' (wide, for sheets/screens)
 */
export function ShareButton({ file, getAuthHeader, variant = 'pill' }) {
  const [state,    setState]    = useState('idle');
  const [progress, setProgress] = useState(0);
  const [errMsg,   setErrMsg]   = useState('');

  const isFull = variant === 'full';

  async function handle() {
    if (state === 'loading') return;
    setState('loading'); setProgress(0); setErrMsg('');
    try {
      await doShare(file, getAuthHeader, p => setProgress(p));
      setState('done');
      setTimeout(() => setState('idle'), 2500);
    } catch (err) {
      if (err.name === 'AbortError') { setState('idle'); return; }
      // Friendly message for the most common error
      let msg = err.message || 'Share failed';
      if (msg.includes('Permission') || msg.includes('403') || msg.includes('permission')) {
        msg = 'Permission denied. Sign out then sign back in to fix.';
      }
      setErrMsg(msg);
      setState('error');
      setTimeout(() => { setState('idle'); setErrMsg(''); }, 5000);
    }
  }

  const label = state === 'loading'
    ? (progress > 0 ? `Downloading ${progress}%` : 'Downloading…')
    : state === 'done'  ? '✓ Sent!'
    : state === 'error' ? '⚠ Retry'
    : isFull ? '📤 Share / Download'
    : '↑ Share';

  const bg = state === 'done'  ? 'var(--green)'
    : state === 'error' ? 'var(--red)'
    : 'var(--accent)';

  return (
    <div style={{ width: isFull ? '100%' : undefined, flexShrink: 0 }}>
      <button
        onClick={handle}
        disabled={state === 'loading'}
        style={{
          width:      isFull ? '100%' : undefined,
          padding:    isFull ? '14px 16px' : '7px 13px',
          borderRadius: isFull ? 13 : 9,
          background: state === 'loading' ? 'var(--accent-light)' : bg,
          color: 'white', border: 'none',
          cursor: state === 'loading' ? 'default' : 'pointer',
          fontSize:   isFull ? 15 : 12,
          fontWeight: 700, fontFamily: 'var(--font)',
          minHeight:  isFull ? 52 : 36,
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 7,
          WebkitTapHighlightColor: 'transparent',
          transition: 'background .2s',
        }}>
        {state === 'loading' && (
          <span className="spin" style={{
            display: 'inline-block',
            width:   isFull ? 16 : 12,
            height:  isFull ? 16 : 12,
            border: '2px solid rgba(255,255,255,.3)',
            borderTopColor: 'white', borderRadius: '50%',
          }} />
        )}
        {label}
      </button>

      {/* Progress bar for full variant */}
      {isFull && state === 'loading' && progress > 0 && (
        <div style={{ height: 3, background: 'var(--sand)',
          borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 2, background: 'var(--accent)',
            width: `${progress}%`, transition: 'width .3s ease',
          }} />
        </div>
      )}

      {/* Error message for full variant */}
      {isFull && state === 'error' && errMsg && (
        <p style={{ fontSize: 12, color: 'var(--red)',
          marginTop: 6, textAlign: 'center' }}>{errMsg}</p>
      )}
    </div>
  );
}

export default ShareButton;
