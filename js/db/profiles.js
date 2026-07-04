import { sb } from '../supabaseClient.js';

export async function getMyProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProfilesByIds(userIds) {
  if (userIds.length === 0) return [];
  const { data, error } = await sb.from('profiles').select('*').in('id', userIds);
  if (error) throw error;
  return data;
}

export async function getAllProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('display_name');
  if (error) throw error;
  return data;
}

// Creates the caller's own profile row on first login. RLS only allows
// inserting a row where id = auth.uid().
export async function createMyProfile({ id, displayName, avatarPath, publicKeyB64 }) {
  const { data, error } = await sb
    .from('profiles')
    .insert({ id, display_name: displayName, avatar_path: avatarPath || null, public_key: publicKeyB64 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(userId, { displayName, avatarPath }) {
  const patch = { updated_at: new Date().toISOString() };
  if (displayName !== undefined) patch.display_name = displayName;
  if (avatarPath !== undefined) patch.avatar_path = avatarPath;
  const { data, error } = await sb.from('profiles').update(patch).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}
