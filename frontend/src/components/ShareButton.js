import React, { useState } from 'react';
import { BASE } from '../utils/api';

/**
 * Downloads a file from Drive via the backend proxy, then shares or downloads it.
 * Auto-retries once with a fresh token on 401/403 before showing the error.
 */
async function doShare(file, getAuthHeader, onProgress) {
  async function attempt() {
    const authHeader = await getAuthHeader(); // always fetches fresh / auto-refreshed
    const url = `${BASE}/drive/file/${file.id}/download?filename=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, { headers: { Authorization: authHeader } });

    if (!response.ok) {
      let errMsg;
      try { errMsg = (await response.json()).error; } catch { errMsg = response.statusText; }
      const err = new Error(errMsg || `Download failed (${response.status})`);
      err.status = response.status;
      throw err;
    }
    return response;
  }

  let response;
  try {
    response = await attempt();
  } catch (firstErr) {
    // On 401 / 403: wait 1 s then retry once — token may have just expired
    if (firstErr.status === 401 || firstErr.status === 403) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        response = await attempt();
      } catch (retryErr) {
        // After retry still failing — surface a clear, actionable message
        if (retryErr.status === 401 || retryErr.status === 403) {
          throw new Error(
            'Access denied. Sign out (top-right) then sign back in ' +
            'and allow Google Drive permission when prompted.'
          );
        }
        throw retryErr;
      }
    } else {
      throw firstErr;
    }
  }

  // Stream with progress
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

  const blob    = new Blob(chunks, { type: file.mimeType || 'application/octet-stream' });
  const fileObj = new File([blob], file.name, { type: blob.type });

  const canNativeShare =
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [fileObj] });

  if (canNativeShare) {
    await navigator.share({ files: [fileObj], title: file.name });
  } else {
    // Desktop fallback — browser download
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * ShareButton
 * variant = 'pill'  — compact, for list rows
 * variant = 'full'  — full-width, for sheets / success screens
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
      setErrMsg(err.message || 'Share failed');
      setState('error');
      setTimeout(() => { setState('idle'); setErrMsg(''); }, 6000);
    }
  }

  const label =
    state === 'loading' ? (progress > 0 ? `${progress}%` : '…')
    : state === 'done'  ? '✓ Done!'
    : state === 'error' ? '⚠ Retry'
    : isFull            ? '📤 Share / Download'
    :                     '↑ Share';

  const bg =
    state === 'done'  ? 'var(--green)'
    : state === 'error' ? 'var(--red)'
    : 'var(--accent)';

  return (
    <div style={{ width: isFull ? '100%' : undefined, flexShrink: 0 }}>
      <button
        onClick={handle}
        disabled={state === 'loading'}
        style={{
          width:        isFull ? '100%' : undefined,
          padding:      isFull ? '14px 16px' : '7px 13px',
          borderRadius: isFull ? 13 : 9,
          background:   state === 'loading' ? 'var(--accent-light)' : bg,
          color: 'white', border: 'none',
          cursor:     state === 'loading' ? 'default' : 'pointer',
          fontSize:   isFull ? 15 : 12,
          fontWeight: 700, fontFamily: 'var(--font)',
          minHeight:  isFull ? 52 : 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          WebkitTapHighlightColor: 'transparent',
          transition: 'background .2s',
        }}>
        {state === 'loading' && (
          <span className="spin" style={{
            display: 'inline-block',
            width:   isFull ? 16 : 12,
            height:  isFull ? 16 : 12,
            border:  '2px solid rgba(255,255,255,.3)',
            borderTopColor: 'white', borderRadius: '50%',
          }} />
        )}
        {label}
      </button>

      {isFull && state === 'loading' && progress > 0 && (
        <div style={{ height: 3, background: 'var(--sand)', borderRadius: 2,
          marginTop: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent)',
            width: `${progress}%`, transition: 'width .3s ease' }} />
        </div>
      )}

      {isFull && state === 'error' && errMsg && (
        <p style={{ fontSize: 12, color: 'var(--red)', marginTop: 6,
          textAlign: 'center', lineHeight: 1.5 }}>{errMsg}</p>
      )}
    </div>
  );
}

export default ShareButton;
