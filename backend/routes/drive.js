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

module.exports = router;
