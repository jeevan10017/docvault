const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadFileToDrive } = require('../services/driveService');

const upload = multer({
  dest: '/tmp/docvault-uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/heic','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported type: ${file.mimetype}`));
  },
});

function requireTokens(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const raw = Buffer.from(auth.replace('Bearer ', ''), 'base64').toString();
    const parsed = JSON.parse(raw);
    req.tokens = { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expiry_date: parsed.expiry_date };
    req.user = parsed.user;
    next();
  } catch { res.status(401).json({ error: 'Invalid token.' }); }
}

/**
 * POST /upload
 * Form fields:
 *   document     – file (required)
 *   customName   – rename the file (optional)
 *   folderPath   – Drive folder path e.g. "Identity/Aadhaar" (required)
 *   folderId     – Drive folder ID if already known (optional, skips folder lookup)
 */
router.post('/', requireTokens, upload.single('document'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });

  const folderPath = req.body.folderPath?.trim();
  const folderId   = req.body.folderId?.trim();

  if (!folderPath && !folderId) {
    fs.existsSync(file.path) && fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'folderPath or folderId is required.' });
  }

  const tempPath = file.path;

  try {
    const ext = path.extname(file.originalname) || '';
    let finalName = req.body.customName?.trim() || file.originalname;
    if (ext && !finalName.toLowerCase().endsWith(ext.toLowerCase())) {
      finalName = finalName.replace(/\.[^.]+$/, '') + ext;
    }
    finalName = finalName.replace(/[/\\]/g, '_');

    console.log(`\n📤 Uploading "${finalName}" → DocVault/${folderPath || folderId}`);

    const driveFile = await uploadFileToDrive(req.tokens, {
      filePath:   tempPath,
      fileName:   finalName,
      mimeType:   file.mimetype,
      folderPath: folderPath || null,
      folderId:   folderId   || null,
    });

    console.log(`   ✅ ${driveFile.webViewLink}`);

    res.json({
      success: true,
      file: {
        id:           driveFile.id,
        name:         driveFile.name,
        originalName: file.originalname,
        viewLink:     driveFile.webViewLink,
        size:         file.size,
        folderPath:   folderPath || null,
      },
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

module.exports = router;
