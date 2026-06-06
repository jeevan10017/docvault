/**
 * localStorage cache with TTL.
 *
 * Keys:
 *   dv_cache_folders          — list of DocVault folders
 *   dv_cache_folder_{id}      — paginated file list for a folder
 *   dv_cache_thumb_{fileId}   — base64 thumbnail
 *
 * TTL: folders = 10 min, files = 5 min, thumbs = 60 min
 */

const PREFIX = 'dv_cache_';
const TTL = { folders: 10*60*1000, files: 5*60*1000, thumbs: 60*60*1000 };

function write(key, data, ttl) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Storage full — clear old cache and retry
    clearOldEntries();
    try { localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch { /* give up */ }
  }
}

function read(key, ttl) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function clearOldEntries() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
  keys.forEach(k => {
    try {
      const { ts } = JSON.parse(localStorage.getItem(k));
      if (Date.now() - ts > TTL.thumbs) localStorage.removeItem(k);
    } catch { localStorage.removeItem(k); }
  });
}

export const cache = {
  getFolders()          { return read('folders', TTL.folders); },
  setFolders(data)      { write('folders', data, TTL.folders); },

  getFolderFiles(id, page) { return read(`folder_${id}_p${page}`, TTL.files); },
  setFolderFiles(id, page, data) { write(`folder_${id}_p${page}`, data, TTL.files); },

  getThumb(fileId)      { return read(`thumb_${fileId}`, TTL.thumbs); },
  setThumb(fileId, b64) { write(`thumb_${fileId}`, b64, TTL.thumbs); },

  invalidateFolderFiles(id) {
    // Remove all page caches for this folder
    Object.keys(localStorage)
      .filter(k => k.startsWith(`${PREFIX}folder_${id}_p`))
      .forEach(k => localStorage.removeItem(k));
  },

  invalidateAll() {
    Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
  },
};
