/**
 * Naming utility — date-time based unique names + per-folder sequential counter.
 *
 * Default format: FolderPrefix_YYYYMMDD_HHmmss_XXX
 * e.g.  Aadhaar_20250615_143022_001.pdf
 *
 * The timestamp makes every name unique.
 * The 3-digit suffix handles the rare case of 2 uploads in the same second.
 * Counter increments only after a successful upload.
 */

const KEY = 'dv_name_counters';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(c) { localStorage.setItem(KEY, JSON.stringify(c)); }
function pad(n, w = 3) { return String(n).padStart(w, '0'); }

/** Folder leaf → CamelCase prefix. "Finance/Bank Statements" → "BankStatements" */
export function folderToPrefix(folderPath) {
  if (!folderPath) return 'Document';
  const leaf = folderPath.split('/').pop() || 'Document';
  return leaf.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** Format a Date as YYYYMMDD_HHmmss */
function datestamp(d = new Date()) {
  const Y  = d.getFullYear();
  const M  = pad(d.getMonth() + 1, 2);
  const D  = pad(d.getDate(), 2);
  const h  = pad(d.getHours(), 2);
  const m  = pad(d.getMinutes(), 2);
  const s  = pad(d.getSeconds(), 2);
  return `${Y}${M}${D}_${h}${m}${s}`;
}

/**
 * Get the next sequential name.
 * Format: Prefix_YYYYMMDD_HHmmss_NNN.ext
 * e.g.   Aadhaar_20250615_143022_001.pdf
 *
 * @param folderPath  "Identity/Aadhaar"
 * @param fileExt     ".pdf"
 * @param offset      0-based offset for multi-file batches
 */
export function getSequentialName(folderPath, fileExt, offset = 0) {
  const counters = load();
  const key      = folderPath || 'Other';
  const n        = (counters[key] || 0) + 1 + offset;
  const prefix   = folderToPrefix(folderPath);
  const dot      = fileExt ? (fileExt.startsWith('.') ? fileExt : '.' + fileExt) : '';
  return `${prefix}_${datestamp()}_${pad(n)}${dot}`;
}

/** Call ONLY after a successful upload. */
export function confirmUsed(folderPath) {
  const c = load(); const k = folderPath || 'Other';
  c[k] = (c[k] || 0) + 1; save(c);
}

export function previewNames(folderPath, fileExt, count = 4) {
  return Array.from({ length: count }, (_, i) => getSequentialName(folderPath, fileExt, i));
}
export function getCurrentCount(folderPath) { return load()[folderPath || 'Other'] || 0; }
export function resetCounter(folderPath) { const c=load(); delete c[folderPath||'Other']; save(c); }
export function sanitise(name) { return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'Document'; }
export function withExt(name, originalFilename) {
  const m = originalFilename.match(/(\.[^.]+)$/);
  const e = m ? m[1].toLowerCase() : '';
  if (!e) return name;
  return name.replace(/\.[^.]+$/, '') + e;
}
export function getExt(filename) {
  const m = filename.match(/(\.[^.]+)$/); return m ? m[1].toLowerCase() : '';
}
