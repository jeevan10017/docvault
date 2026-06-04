const express = require('express');
const router = express.Router();
const { listDocVaultFiles, listDocVaultFolders, createFolderPath } = require('../services/driveService');

function requireTokens(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const raw = Buffer.from(auth.replace('Bearer ', ''), 'base64').toString();
    const parsed = JSON.parse(raw);
    req.tokens = { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expiry_date: parsed.expiry_date };
    next();
  } catch { res.status(401).json({ error: 'Invalid token.' }); }
}

/** GET /drive/files — list files in DocVault root */
router.get('/files', requireTokens, async (req, res) => {
  try {
    const files = await listDocVaultFiles(req.tokens, req.query.folder || '');
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /drive/folders — list all folders inside DocVault (for picker dropdown) */
router.get('/folders', requireTokens, async (req, res) => {
  try {
    const folders = await listDocVaultFolders(req.tokens);
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /drive/folders — create a new folder path under DocVault */
router.post('/folders', requireTokens, async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath?.trim()) return res.status(400).json({ error: 'folderPath is required.' });
  try {
    const folder = await createFolderPath(req.tokens, folderPath.trim());
    res.json({ folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/** GET /drive/file/:fileId/download
 *  Streams the actual file bytes from Google Drive through the backend.
 *  This is needed because Drive API calls are authenticated — the browser
 *  cannot call Drive directly with the user's token.
 *
 *  Query params:
 *    filename  (optional) — sets Content-Disposition filename
 *    mimeType  (optional) — overrides Content-Type
 */
router.get('/file/:fileId/download', requireTokens, async (req, res) => {
  const { fileId } = req.params;
  const { filename, mimeType } = req.query;

  try {
    const { getDriveClient } = require('../services/driveService');
    const drive = getDriveClient(req.tokens);

    // First fetch file metadata so we know the real name + mime type
    let meta;
    try {
      const metaRes = await drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size',
      });
      meta = metaRes.data;
    } catch (e) {
      return res.status(404).json({ error: 'File not found or not accessible.' });
    }

    const safeName    = filename || meta.name || 'document';
    const contentType = mimeType  || meta.mimeType || 'application/octet-stream';

    // Set headers so the browser / native share knows what it's receiving
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName.replace(/"/g, '\')}"`);
    if (meta.size) res.setHeader('Content-Length', meta.size);
    // Allow browser to cache for 5 minutes (reduces repeat downloads)
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Stream file content directly to response
    const fileRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    fileRes.data
      .on('error', (err) => {
        console.error('Drive stream error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      })
      .pipe(res);

  } catch (err) {
    console.error('Download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
