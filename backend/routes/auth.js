const express = require('express');
const router = express.Router();
const { createOAuth2Client, SCOPES } = require('../config/google');

/**
 * GET /auth/google
 * Redirects the user to Google's consent screen.
 * The frontend calls this URL to begin the login flow.
 */
router.get('/google', (req, res) => {
  const oauth2Client = createOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',  // Gets a refresh token too
    scope: SCOPES,
    prompt: 'consent',       // Forces consent screen to always get refresh token
  });

  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google redirects here after the user approves.
 * We exchange the `code` for access + refresh tokens, then
 * redirect to the frontend with the tokens in the URL hash.
 *
 * In production, store tokens server-side (DB) and use sessions.
 * For this demo, tokens are passed to the frontend via URL hash.
 */
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}?auth_error=${error}`);
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Get user info
    oauth2Client.setCredentials(tokens);
    const { google } = require('googleapis');
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Encode tokens + user info as base64 and pass to frontend
    // In production: store in DB, use HTTP-only session cookie
    const payload = Buffer.from(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      user: {
        name: userInfo.name,
        email: userInfo.email,
        picture: userInfo.picture,
      }
    })).toString('base64');

    res.redirect(`${process.env.FRONTEND_URL}/auth/success#${payload}`);
  } catch (err) {
    console.error('Token exchange error:', err);
    res.redirect(`${process.env.FRONTEND_URL}?auth_error=token_exchange_failed`);
  }
});

/**
 * POST /auth/refresh
 * Body: { refresh_token }
 * Returns: { access_token, expiry_date }
 */
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token });
    const { credentials } = await oauth2Client.refreshAccessToken();
    res.json({
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;
