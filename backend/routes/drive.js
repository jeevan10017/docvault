const express = require('express');
const router  = express.Router();
const {
  listDocVaultFiles,
  listDocVaultFolders,
  listAllDocVaultFiles,
  createFolderPath,
  getDriveClient,
} = require('../services/driveService');

function requireTokens(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const raw    = Buffer.from(auth.replace('Bearer ', ''), 'base64').toString();
    const parsed = JSON.parse(raw);
    req.tokens   = {
      access_token:  parsed.access_token,
      refresh_token: parsed.refresh_token,
      expiry_date:   parsed.expiry_date,
    };
    next();
  } catch { res.status(401).json({ error: 'Invalid token.' }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/folders
// Returns all sub-folders inside DocVault (for the folder picker + dashboard)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/folders', requireTokens, async (req, res) => {
  try {
    const folders = await listDocVaultFolders(req.tokens);
    res.json({ folders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /drive/folders
// Body: { folderPath }  e.g. "Identity/Aadhaar"
// ─────────────────────────────────────────────────────────────────────────────
router.post('/folders', requireTokens, async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath?.trim()) return res.status(400).json({ error: 'folderPath required.' });
  try {
    const folder = await createFolderPath(req.tokens, folderPath.trim());
    res.json({ folder });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/folder-files
// Paginated file list for a single folder.
// Query: folderId (required), pageToken, pageSize (default 10)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/folder-files', requireTokens, async (req, res) => {
  const { folderId, pageToken, pageSize = '10' } = req.query;
  if (!folderId) return res.status(400).json({ error: 'folderId required.' });
  try {
    const drive  = getDriveClient(req.tokens);
    const params = {
      spaces:  'drive',
      corpora: 'user',
      includeItemsFromAllDrives: false,
      q: `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
      fields:  'nextPageToken, files(id,name,mimeType,size,createdTime,webViewLink,thumbnailLink)',
      orderBy: 'createdTime desc',
      pageSize: Math.min(parseInt(pageSize) || 10, 50),
    };
    if (pageToken) params.pageToken = pageToken;
    const result = await drive.files.list(params);
    res.json({
      files:         result.data.files        || [],
      nextPageToken: result.data.nextPageToken || null,
    });
  } catch (err) {
    console.error('folder-files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/all-files
// Recursive, paginated, all files across all subfolders.
// Query: search (optional name filter)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all-files', requireTokens, async (req, res) => {
  try {
    const files = await listAllDocVaultFiles(req.tokens, req.query.search || '');
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/files  (legacy — kept for upload route compatibility)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/files', requireTokens, async (req, res) => {
  try {
    const files = await listDocVaultFiles(req.tokens, req.query.folder || '');
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/file/:fileId/download
// Streams file bytes from Drive → client.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/file/:fileId/download', requireTokens, async (req, res) => {
  const { fileId }              = req.params;
  const { filename, mimeType }  = req.query;
  try {
    const drive = getDriveClient(req.tokens);
    let meta;
    try {
      const r = await drive.files.get({
        fileId, fields: 'id,name,mimeType,size', supportsAllDrives: true,
      });
      meta = r.data;
    } catch (e) {
      const s = e.status || e.code;
      if (s === 404) return res.status(404).json({ error: 'File not found.' });
      if (s === 403) return res.status(403).json({ error: 'Permission denied. Sign out then sign in again.' });
      return res.status(400).json({ error: e.message });
    }

    const safeName    = filename || meta.name || 'document';
    const contentType = mimeType  || meta.mimeType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(safeName));
    if (meta.size) res.setHeader('Content-Length', meta.size);
    res.setHeader('Cache-Control', 'private, max-age=300');

    let stream;
    try {
      stream = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
    } catch (e) {
      const s = e.status || e.code;
      if (s === 403) return res.status(403).json({ error: 'Permission denied. Sign out then sign in again.' });
      return res.status(500).json({ error: e.message });
    }

    req.on('close', () => stream.data.destroy());
    stream.data
      .on('error', err => { if (!res.headersSent) res.status(500).end(); })
      .pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /drive/file/:fileId/rename
// Body: { name }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/file/:fileId/rename', requireTokens, async (req, res) => {
  const { fileId } = req.params;
  const { name }   = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required.' });
  try {
    const drive  = getDriveClient(req.tokens);
    const result = await drive.files.update({
      fileId,
      requestBody:       { name: name.trim() },
      fields:            'id,name',
      supportsAllDrives: true,
    });
    res.json({ file: result.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /drive/file/:fileId/thumbnail
// Proxies Drive's thumbnailLink (which requires auth).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/file/:fileId/thumbnail', requireTokens, async (req, res) => {
  const { fileId } = req.params;
  try {
    const drive = getDriveClient(req.tokens);
    const meta  = await drive.files.get({
      fileId, fields: 'thumbnailLink,mimeType', supportsAllDrives: true,
    });
    const thumbUrl = meta.data.thumbnailLink;
    if (!thumbUrl) return res.status(404).json({ error: 'No thumbnail available.' });

    // Get access token from the auth client
    const auth    = drive.context._options.auth;
    const tokenRes = await auth.getAccessToken();
    const token   = tokenRes.token || tokenRes.access_token;

    const nodeFetch = require('node-fetch');
    const resp = await nodeFetch(thumbUrl.replace('=s220', '=s400'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return res.status(404).json({ error: 'Thumbnail fetch failed.' });

    res.setHeader('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    resp.body.pipe(res);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// module.exports MUST be at the end — routes defined after this are ignored
// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;
