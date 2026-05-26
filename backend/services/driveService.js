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

/** Find or create a folder by name inside parentId. */
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

/** Get the DocVault root folder ID (creates it if missing). */
async function getDocVaultRootId(drive) {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
  return findOrCreateFolder(drive, 'DocVault', root);
}

/**
 * Resolve a slash-separated path under DocVault, creating folders as needed.
 * e.g. "Identity/Aadhaar" → creates DocVault/Identity/Aadhaar and returns the leaf ID.
 */
async function resolveOrCreateFolderPath(drive, folderPath) {
  const rootId = await getDocVaultRootId(drive);
  const parts = folderPath.split('/').filter(Boolean);
  let current = rootId;
  for (const part of parts) {
    current = await findOrCreateFolder(drive, part, current);
  }
  return current;
}

/** Upload a file. Accepts either folderPath (string) or folderId (Drive ID). */
async function uploadFileToDrive(tokens, { filePath, fileName, mimeType, folderPath, folderId }) {
  const drive = getDriveClient(tokens);

  let targetFolderId;
  if (folderId) {
    targetFolderId = folderId;
  } else {
    targetFolderId = await resolveOrCreateFolderPath(drive, folderPath);
  }

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [targetFolderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id,name,webViewLink,webContentLink,size,createdTime',
  });
  return response.data;
}

/**
 * List ALL folders inside DocVault recursively (up to 2 levels deep).
 * Returns flat array of { id, name, path, parentId }.
 * Used by the frontend folder picker dropdown.
 */
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
    if (depth > 3) return; // cap depth
    const res = await drive.files.list({
      ...LIST_OPTS,
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      orderBy: 'name',
      pageSize: 50,
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

/**
 * Create a brand new folder at the given path under DocVault.
 * Returns { id, name, path }.
 */
async function createFolderPath(tokens, folderPath) {
  const drive = getDriveClient(tokens);
  const id = await resolveOrCreateFolderPath(drive, folderPath);
  return { id, name: folderPath.split('/').pop(), path: folderPath };
}

/** List recent files inside DocVault root (for dashboard). */
async function listDocVaultFiles(tokens, folderPath = '') {
  const drive = getDriveClient(tokens);
  const rootId = await getDocVaultRootId(drive);

  let folderId = rootId;
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

module.exports = { uploadFileToDrive, listDocVaultFiles, listDocVaultFolders, createFolderPath, getDriveClient };
