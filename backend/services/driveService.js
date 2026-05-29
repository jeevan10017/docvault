const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/google');
const fs = require('fs');

function getDriveClient(tokens) {
  const auth = createOAuth2Client();
  auth.setCredentials(tokens);
  return google.drive({ version: 'v3', auth });
}

const LIST_OPTS = {
  spaces: 'drive',
  corpora: 'user',
  includeItemsFromAllDrives: false,
};

/** Find a folder by name inside a parent. Returns id or null. */
async function findFolder(drive, name, parentId) {
  const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await drive.files.list({
    ...LIST_OPTS,
    q: `name='${safe}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id,name)',
    orderBy: 'createdTime',
    pageSize: 5,
  });
  return res.data.files.length > 0 ? res.data.files[0].id : null;
}

/** Find or create a folder by name inside parentId. Always returns a valid ID. */
async function findOrCreateFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;

  console.log(`   📁 Creating folder "${name}" inside ${parentId}`);
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name',
  });
  console.log(`   ✅ Created "${name}" → ${res.data.id}`);
  return res.data.id;
}

/** Get (or create) the top-level DocVault folder ID. */
async function getDocVaultRootId(drive) {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
  return findOrCreateFolder(drive, 'DocVault', root);
}

/**
 * Resolve a slash-separated path under DocVault, creating all folders.
 * e.g. "Identity/Aadhaar" → creates DocVault/Identity/Aadhaar, returns leaf ID.
 */
async function resolveOrCreateFolderPath(drive, folderPath) {
  const rootId = await getDocVaultRootId(drive);
  const parts  = (folderPath || '').split('/').filter(Boolean);
  let current  = rootId;
  for (const part of parts) {
    current = await findOrCreateFolder(drive, part, current);
  }
  return current;
}

/**
 * Upload a file to Google Drive.
 *
 * IMPORTANT: We ALWAYS resolve via folderPath, never trust a client-provided
 * folderId directly. Drive folder IDs stored on the client can go stale
 * (folder deleted and recreated, different account, etc.) causing
 * "File not found" errors. folderPath is the source of truth.
 *
 * @param {object} tokens
 * @param {object} opts - { filePath, fileName, mimeType, folderPath, folderId }
 */
async function uploadFileToDrive(tokens, { filePath, fileName, mimeType, folderPath, folderId }) {
  const drive = getDriveClient(tokens);

  // Always resolve the folder fresh from the path.
  // If folderPath is empty but folderId is provided, try the folderId as a
  // fallback — but wrap in try/catch so a stale ID never kills the upload.
  let targetFolderId;

  if (folderPath) {
    // Preferred: resolve by path — creates folders if missing, always reliable
    console.log(`   📂 Resolving folder path: DocVault/${folderPath}`);
    targetFolderId = await resolveOrCreateFolderPath(drive, folderPath);
  } else if (folderId) {
    // Fallback: try the provided ID — verify it exists first
    try {
      await drive.files.get({ fileId: folderId, fields: 'id,name,trashed' });
      targetFolderId = folderId;
      console.log(`   📂 Using provided folderId: ${folderId}`);
    } catch (e) {
      // Stale ID — fall back to DocVault root
      console.warn(`   ⚠️  folderId ${folderId} not accessible (${e.message}), uploading to DocVault root`);
      targetFolderId = await getDocVaultRootId(drive);
    }
  } else {
    // No folder specified — use DocVault root
    targetFolderId = await getDocVaultRootId(drive);
  }

  console.log(`   📤 Uploading "${fileName}" to folder ${targetFolderId}`);

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [targetFolderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id,name,webViewLink,webContentLink,size,createdTime',
  });

  console.log(`   ✅ Uploaded: ${response.data.webViewLink}`);
  return response.data;
}

/** List ALL sub-folders inside DocVault (for picker). */
async function listDocVaultFolders(tokens) {
  const drive = getDriveClient(tokens);

  let docVaultId;
  try {
    docVaultId = await getDocVaultRootId(drive);
  } catch (err) {
    console.error('listDocVaultFolders error:', err.message);
    return [];
  }

  const folders = [{ id: docVaultId, name: 'DocVault', path: '', parentId: null }];

  async function listChildren(parentId, parentPath, depth) {
    if (depth > 4) return;
    const res = await drive.files.list({
      ...LIST_OPTS,
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: 100,
    });
    for (const f of res.data.files) {
      const p = parentPath ? `${parentPath}/${f.name}` : f.name;
      folders.push({ id: f.id, name: f.name, path: p, parentId });
      await listChildren(f.id, p, depth + 1);
    }
  }

  await listChildren(docVaultId, '', 1);
  return folders;
}

/** Create a folder path and return { id, name, path }. */
async function createFolderPath(tokens, folderPath) {
  const drive = getDriveClient(tokens);
  const id    = await resolveOrCreateFolderPath(drive, folderPath);
  return { id, name: folderPath.split('/').pop(), path: folderPath };
}

/** List recent files inside DocVault (for dashboard). */
async function listDocVaultFiles(tokens, folderPath = '') {
  const drive    = getDriveClient(tokens);
  const rootId   = await getDocVaultRootId(drive);
  let folderId   = rootId;

  if (folderPath) {
    const parts = folderPath.split('/').filter(Boolean);
    for (const part of parts) {
      folderId = await findOrCreateFolder(drive, part, folderId);
    }
  }

  const res = await drive.files.list({
    ...LIST_OPTS,
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });
  return res.data.files;
}

module.exports = {
  uploadFileToDrive,
  listDocVaultFiles,
  listDocVaultFolders,
  createFolderPath,
  getDriveClient,
};
