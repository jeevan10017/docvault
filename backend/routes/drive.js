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

/** GET /drive/files — list files in DocVault root folder (shallow, recent 100) */
router.get('/files', requireTokens, async (req, res) => {
  try {
    const files = await listDocVaultFiles(req.tokens, req.query.folder || '');
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /drive/all-files
 * Lists EVERY file inside DocVault recursively — all subfolders, all pages.
 * Supports ?search=query for name filtering.
 */
router.get('/all-files', requireTokens, async (req, res) => {
  try {
    const files = await listAllDocVaultFiles(req.tokens, req.query.search || '');
    res.json({ files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /drive/folders */
router.get('/folders', requireTokens, async (req, res) => {
  try {
    const folders = await listDocVaultFolders(req.tokens);
    res.json({ folders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** POST /drive/folders */
router.post('/folders', requireTokens, async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath?.trim()) return res.status(400).json({ error: 'folderPath is required.' });
  try {
    const folder = await createFolderPath(req.tokens, folderPath.trim());
    res.json({ folder });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /drive/file/:fileId/download
 * Streams the actual file bytes from Google Drive through the backend.
 *
 * Handles:
 *  - Token auto-refresh if expired
 *  - supportsAllDrives for files in any drive
 *  - Old files uploaded with any scope
 */
router.get('/file/:fileId/download', requireTokens, async (req, res) => {
  const { fileId }            = req.params;
  const { filename, mimeType } = req.query;

  try {
    const drive = getDriveClient(req.tokens);

    // Fetch metadata — supportsAllDrives covers files from any upload session
    let meta;
    try {
      const metaRes = await drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      });
      meta = metaRes.data;
    } catch (e) {
      const status = e.status || e.code;
      if (status === 404) return res.status(404).json({ error: 'File not found in Drive.' });
      if (status === 403) return res.status(403).json({
        error: 'Permission denied. Sign out and sign in again to refresh permissions.',
      });
      return res.status(400).json({ error: e.message });
    }

    const safeName    = filename || meta.name || 'document';
    const contentType = mimeType  || meta.mimeType || 'application/octet-stream';

    const encodedName = encodeURIComponent(safeName);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodedName);
    if (meta.size) res.setHeader('Content-Length', meta.size);
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Stream file bytes
    let fileRes;
    try {
      fileRes = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );
    } catch (e) {
      const status = e.status || e.code;
      if (status === 403) return res.status(403).json({
        error: 'Cannot download this file. Sign out and sign in again to refresh your permissions.',
      });
      return res.status(500).json({ error: e.message });
    }

    req.on('close', () => fileRes.data.destroy());
    fileRes.data
      .on('error', err => {
        console.error('Stream error:', err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);

  } catch (err) {
    console.error('Download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
