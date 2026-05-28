const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const { uploadFileToDrive } = require('../services/driveService');

const upload = multer({ dest: '/tmp/docvault-pdf/', limits: { fileSize: 50 * 1024 * 1024 } });

function requireTokens(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const raw  = Buffer.from(auth.replace('Bearer ', ''), 'base64').toString('utf-8');
    const p    = JSON.parse(raw);
    req.tokens = { access_token: p.access_token, refresh_token: p.refresh_token, expiry_date: p.expiry_date };
    next();
  } catch { res.status(401).json({ error: 'Invalid token.' }); }
}

/**
 * POST /pdf/merge
 * Receives multiple PDF files, merges them with pdf-lib, uploads to Drive.
 * Body (multipart): files[] + folderPath + folderId + fileName
 */
router.post('/merge', requireTokens, upload.array('files', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded.' });

  const { PDFDocument } = require('pdf-lib');
  const mergedDoc  = await PDFDocument.create();
  const tmpOut     = `/tmp/docvault-pdf/merged_${Date.now()}.pdf`;

  try {
    for (const file of req.files) {
      const bytes = fs.readFileSync(file.path);
      try {
        const doc   = await PDFDocument.load(bytes);
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => mergedDoc.addPage(p));
      } catch { /* skip corrupt page */ }
    }

    const pdfBytes = await mergedDoc.save();
    fs.writeFileSync(tmpOut, pdfBytes);

    const fileName = (req.body.fileName || 'merged.pdf').replace(/\.pdf$/i, '') + '.pdf';
    const driveFile = await uploadFileToDrive(req.tokens, {
      filePath:   tmpOut,
      fileName,
      mimeType:   'application/pdf',
      folderPath: req.body.folderPath || 'Other',
      folderId:   req.body.folderId  || null,
    });

    res.json({ success: true, file: { id: driveFile.id, name: driveFile.name, viewLink: driveFile.webViewLink } });
  } finally {
    req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    fs.existsSync(tmpOut) && fs.unlinkSync(tmpOut);
  }
});

module.exports = router;
