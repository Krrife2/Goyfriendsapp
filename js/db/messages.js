import { sb } from '../supabaseClient.js';
import { encryptMessage, decryptMessage } from '../crypto/messageCrypto.js';

const PAGE_SIZE = 50;

export async function fetchMessages(conversationId, { before } = {}) {
  let query = sb
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) throw error;
  return data.reverse(); // oldest-first for rendering
}

// Used for conversation-list previews — just the single newest row.
export async function fetchLatestMessage(conversationId) {
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Decrypts a raw message row's body (and attachment name/type, if present)
// using the conversation's symmetric key. Throws on failure — callers should
// catch per-message so one bad row never breaks the whole thread render.
export async function decryptMessageRow(row, symKey) {
  const body = await decryptMessage(row.ciphertext, row.nonce, symKey);
  let attachmentMeta = null;
  if (row.attachment_path) {
    const metaJson = await decryptMessage(row.attachment_name_ciphertext, row.attachment_name_nonce, symKey);
    attachmentMeta = JSON.parse(metaJson); // { name, type }
  }
  return { ...row, body, attachmentMeta };
}

export async function sendMessage({ conversationId, senderId, symKey, plaintext, replyTo }) {
  const { ciphertext, nonce } = await encryptMessage(plaintext, symKey);
  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender: senderId,
      ciphertext,
      nonce,
      reply_to: replyTo || null,
    })
    .select()
    .single();
  if (error) throw error;

  await sb
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return data;
}

// attachment is { path, name, type, size } — path already uploaded to Storage
// by db/storage.js; name/type get encrypted here alongside the message body.
export async function sendAttachmentMessage({ conversationId, senderId, symKey, caption, attachment, replyTo }) {
  const { ciphertext, nonce } = await encryptMessage(caption || '', symKey);
  const metaJson = JSON.stringify({ name: attachment.name, type: attachment.type });
  const nameEnc = await encryptMessage(metaJson, symKey);

  const { data, error } = await sb
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender: senderId,
      ciphertext,
      nonce,
      reply_to: replyTo || null,
      attachment_path: attachment.path,
      attachment_name_ciphertext: nameEnc.ciphertext,
      attachment_name_nonce: nameEnc.nonce,
      attachment_size: attachment.size,
    })
    .select()
    .single();
  if (error) throw error;

  await sb
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return data;
}

// Re-encrypts new content under the same conversation key and marks the row
// edited. RLS restricts this to the original sender.
export async function editMessage(messageId, symKey, newPlaintext) {
  const { ciphertext, nonce } = await encryptMessage(newPlaintext, symKey);
  const { error } = await sb
    .from('messages')
    .update({ ciphertext, nonce, edited_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

// Soft delete/unsend: the ciphertext column stays not-null (schema
// constraint) and is simply never rendered once deleted_at is set — the
// client treats it as a "message removed" placeholder rather than decrypting
// it. RLS restricts this to the original sender.
export async function unsendMessage(messageId) {
  const { error } = await sb.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
  if (error) throw error;
}

export async function fetchReactions(messageIds) {
  if (messageIds.length === 0) return [];
  const { data, error } = await sb.from('message_reactions').select('*').in('message_id', messageIds);
  if (error) throw error;
  return data;
}

export async function addReaction(messageId, userId, emoji) {
  const { error } = await sb.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
}

export async function removeReaction(messageId, userId, emoji) {
  const { error } = await sb
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) throw error;
}

// Read receipts are opt-in (profiles.read_receipts_enabled, default off) —
// callers should only invoke markMessagesRead for a user who has it turned on.
export async function fetchReads(messageIds) {
  if (messageIds.length === 0) return [];
  const { data, error } = await sb.from('message_reads').select('*').in('message_id', messageIds);
  if (error) throw error;
  return data;
}

export async function markMessagesRead(messageIds, userId) {
  if (messageIds.length === 0) return;
  const rows = messageIds.map((messageId) => ({ message_id: messageId, user_id: userId }));
  const { error } = await sb.from('message_reads').upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}
