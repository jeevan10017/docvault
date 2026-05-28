const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/google');

/**
 * GET /debug/token
 * Pass your token header — this tests EXACTLY what the Drive routes do
 * and prints what goes wrong.
 *
 * Test from browser console (when logged in):
 *   const auth = JSON.parse(localStorage.getItem('docvault_auth'));
 *   const header = 'Bearer ' + btoa(unescape(encodeURIComponent(JSON.stringify(auth))));
 *   fetch('http://localhost:5000/debug/token', { headers: { Authorization: header } })
 *     .then(r => r.json()).then(console.log);
 */
router.get('/token', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.json({
      step: 'HEADER',
      ok: false,
      error: 'No Authorization header. Send: Authorization: Bearer <base64token>',
    });
  }

  // Step 1: decode
  let tokens;
  try {
    const raw = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    tokens = {
      access_token:  parsed.access_token,
      refresh_token: parsed.refresh_token,
      expiry_date:   parsed.expiry_date,
    };
    res.locals.tokenInfo = {
      has_access_token:  !!tokens.access_token,
      has_refresh_token: !!tokens.refresh_token,
      access_token_preview: tokens.access_token?.slice(0, 20) + '...',
      expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      expired: tokens.expiry_date ? Date.now() > tokens.expiry_date : 'unknown',
    };
  } catch (e) {
    return res.json({ step: 'DECODE', ok: false, error: 'Could not base64-decode/JSON-parse the token: ' + e.message });
  }

  // Step 2: build oauth client
  let oauth2Client;
  try {
    oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokens);
  } catch (e) {
    return res.json({ step: 'OAUTH_CLIENT', ok: false, error: e.message, tokenInfo: res.locals.tokenInfo });
  }

  // Step 3: test Drive API — just list 1 file from root
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const result = await drive.files.list({
      pageSize: 1,
      fields: 'files(id,name)',
      spaces: 'drive',
      corpora: 'user',
    });
    return res.json({
      ok: true,
      message: '✅ Drive API working! Token is valid.',
      tokenInfo: res.locals.tokenInfo,
      driveTest: {
        filesReturned: result.data.files.length,
        firstFile: result.data.files[0]?.name || '(no files)',
      },
    });
  } catch (e) {
    return res.json({
      step: 'DRIVE_API',
      ok: false,
      error: e.message,
      statusCode: e.status || e.code,
      tokenInfo: res.locals.tokenInfo,
      hint: e.status === 403
        ? '403 = Token lacks drive scope OR app not verified. Sign out and sign in again to get new scope.'
        : e.status === 401
        ? '401 = Access token expired. The /auth/refresh endpoint should fix this automatically.'
        : 'Check error message above.',
    });
  }
});

module.exports = router;
