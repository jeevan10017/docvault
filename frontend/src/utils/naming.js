/**
 * Sequential naming — per-folder counters in localStorage.
 *
 * Counter only increments AFTER a successful upload (confirmUsed).
 * getNextNumber is pure: reads the counter + offset to handle
 * multiple files queued for the same folder without colliding.
 */

const KEY = 'dv_name_counters';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(c) { localStorage.setItem(KEY, JSON.stringify(c)); }

function pad(n) { return String(n).padStart(3, '0'); }

/**
 * Folder leaf → CamelCase prefix.
 * "Finance/Bank Statements" → "BankStatements"
 * "Other" → "Document"
 */
export function folderToPrefix(folderPath) {
  if (!folderPath) return 'Document';
  const leaf = folderPath.split('/').pop() || 'Document';
  // Title-case each word, join without spaces
  return leaf
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Get the sequential name for a file.
 * @param folderPath  e.g. "Identity/Aadhaar"
 * @param fileExt     e.g. ".pdf" or ".jpg"
 * @param offset      how many files already queued ahead in the same folder (0-based)
 */
export function getSequentialName(folderPath, fileExt, offset = 0) {
  const counters = load();
  const key      = folderPath || 'Other';
  const n        = (counters[key] || 0) + 1 + offset;
  const prefix   = folderToPrefix(folderPath);
  const dot      = fileExt ? (fileExt.startsWith('.') ? fileExt : '.' + fileExt) : '';
  return `${prefix}_${pad(n)}${dot}`;
}

/** Call ONLY after a successful upload. */
export function confirmUsed(folderPath) {
  const c = load();
  const k = folderPath || 'Other';
  c[k]    = (c[k] || 0) + 1;
  save(c);
}

/** Preview next N names (for the settings sheet). */
export function previewNames(folderPath, fileExt, count = 4) {
  return Array.from({ length: count }, (_, i) =>
    getSequentialName(folderPath, fileExt, i)
  );
}

export function getCurrentCount(folderPath) {
  return load()[folderPath || 'Other'] || 0;
}

export function resetCounter(folderPath) {
  const c = load();
  delete c[folderPath || 'Other'];
  save(c);
}

/** Strip illegal filename chars. */
export function sanitise(name) {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'Document';
}

/** Ensure a name carries the right extension. */
export function withExt(name, originalFilename) {
  const m = originalFilename.match(/(\.[^.]+)$/);
  const e = m ? m[1].toLowerCase() : '';
  if (!e) return name;
  const base = name.replace(/\.[^.]+$/, '');
  return base + e;
}

/** Extract extension from a filename. */
export function getExt(filename) {
  const m = filename.match(/(\.[^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}
