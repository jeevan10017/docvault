const { google } = require('googleapis');

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * SCOPE CHANGE: was drive.file — that scope only sees files THIS APP created.
 * If a DocVault folder already exists (created by user or a previous session),
 * drive.file can't find it → creates a duplicate → files scatter.
 *
 * drive scope = full My Drive access (read + write).
 * Users see this on the consent screen; it's the standard scope for file managers.
 *
 * If you re-deploy and users have old tokens, force them to re-consent by
 * hitting /auth/google again (the prompt:'consent' param handles this).
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive',          // ← changed from drive.file
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
];

module.exports = { createOAuth2Client, SCOPES };
