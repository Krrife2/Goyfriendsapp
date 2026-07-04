import { sb } from '../supabaseClient.js';
import { encryptFileBytes, decryptFileBytes } from '../crypto/attachmentCrypto.js';

const AVATAR_BUCKET = 'avatars';
const ATTACHMENT_BUCKET = 'attachments';
const SIGNED_URL_TTL_SECONDS = 3600;

function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Avatars and group photos are ordinary (non-E2E) metadata — same boundary
// every mainstream messenger draws. Path convention matches the storage RLS
// policies in 0002_rls.sql: avatars/user/{userId}/... and
// avatars/conversation/{conversationId}/...
export async function uploadUserAvatar(userId, file) {
  const path = `user/${userId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

export async function uploadGroupPhoto(conversationId, file) {
  const path = `conversation/${conversationId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

export async function getAvatarSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(AVATAR_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// Encrypts the file client-side, then uploads only ciphertext. The real
// filename/MIME type never touch Storage — they're encrypted separately and
// stored in the message row (see db/messages.js sendAttachmentMessage).
export async function uploadEncryptedAttachment(conversationId, file, symKey) {
  const arrayBuffer = await file.arrayBuffer();
  const combined = await encryptFileBytes(arrayBuffer, symKey);
  const path = `${conversationId}/${crypto.randomUUID()}`;
  const { error } = await sb.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, combined, { cacheControl: '3600', upsert: false, contentType: 'application/octet-stream' });
  if (error) throw error;
  return { path, name: file.name, type: file.type, size: file.size };
}

// Downloads and decrypts an attachment, returning a Blob with the real MIME
// type (passed in separately since it lives encrypted in the message row, not
// in Storage's plaintext object metadata).
export async function downloadEncryptedAttachment(path, symKey, mimeType) {
  const { data, error } = await sb.storage.from(ATTACHMENT_BUCKET).download(path);
  if (error) throw error;
  const combined = new Uint8Array(await data.arrayBuffer());
  const plaintextBytes = await decryptFileBytes(combined, symKey);
  return new Blob([plaintextBytes], { type: mimeType || 'application/octet-stream' });
}
