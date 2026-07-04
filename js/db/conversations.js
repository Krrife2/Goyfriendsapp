import { sb } from '../supabaseClient.js';
import { getProfilesByIds } from './profiles.js';
import { createConversationKey, wrapKeyForMember } from '../crypto/conversationKeys.js';

export async function listMyConversations() {
  // conversation_members RLS already restricts this to the caller's own memberships.
  // pinned_at/muted come back for every member's row; the caller picks out
  // their own row by user_id to know their own pin/mute state.
  const { data, error } = await sb
    .from('conversations')
    .select('*, conversation_members(user_id, pinned_at, muted)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setConversationPinned(conversationId, userId, pinned) {
  const { error } = await sb
    .from('conversation_members')
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function setConversationMuted(conversationId, userId, muted) {
  const { error } = await sb
    .from('conversation_members')
    .update({ muted })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function getConversationMembers(conversationId) {
  const { data, error } = await sb
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return getProfilesByIds(data.map((row) => row.user_id));
}

// RLS on conversation_keys only ever returns the caller's own row.
export async function getMyWrappedKey(conversationId) {
  const { data, error } = await sb
    .from('conversation_keys')
    .select('wrapped_key')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.wrapped_key : null;
}

// Creates a conversation, seeds membership, and wraps a fresh symmetric key to
// every member's public key (including the creator's own). memberUserIds must
// include the creator's own id.
export async function createConversation({ title, isGroup, creatorId, memberUserIds }) {
  const { data: conversation, error: convError } = await sb
    .from('conversations')
    .insert({ title: title || null, is_group: isGroup, created_by: creatorId })
    .select()
    .single();
  if (convError) throw convError;

  const memberRows = memberUserIds.map((userId) => ({ conversation_id: conversation.id, user_id: userId }));
  const { error: membersError } = await sb.from('conversation_members').insert(memberRows);
  if (membersError) throw membersError;

  const memberProfiles = await getProfilesByIds(memberUserIds);
  const symKey = await createConversationKey();
  const keyRows = await Promise.all(
    memberProfiles.map(async (profile) => ({
      conversation_id: conversation.id,
      user_id: profile.id,
      wrapped_key: await wrapKeyForMember(symKey, profile.public_key),
    }))
  );
  const { error: keysError } = await sb.from('conversation_keys').insert(keyRows);
  if (keysError) throw keysError;

  return conversation;
}

export async function renameConversation(conversationId, title) {
  const { error } = await sb
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

export async function updateConversationPhoto(conversationId, photoPath) {
  const { error } = await sb
    .from('conversations')
    .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

// Adds an existing member's already-known symmetric key to a new invitee.
// Does not rotate the key (documented v1 limitation — see README).
export async function addMemberToConversation(conversationId, newUserId, symKey) {
  const { error: memberError } = await sb
    .from('conversation_members')
    .insert({ conversation_id: conversationId, user_id: newUserId });
  if (memberError) throw memberError;

  const [profile] = await getProfilesByIds([newUserId]);
  const wrappedKey = await wrapKeyForMember(symKey, profile.public_key);
  const { error: keyError } = await sb
    .from('conversation_keys')
    .insert({ conversation_id: conversationId, user_id: newUserId, wrapped_key: wrappedKey });
  if (keyError) throw keyError;
}
