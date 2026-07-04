// Per-conversation symmetric key generation and per-member key wrapping.
// A bug here (e.g. wrapping to the wrong public key) silently breaks
// confidentiality for a whole conversation, so keep this module small and boring.

import { getSodium } from './sodium.js';

// Decrypted symmetric keys are cached in memory only for the current session —
// never written back to IndexedDB. Re-deriving from the sealed row via the
// identity private key is cheap, so there's no reason to persist the plaintext key.
const sessionKeyCache = new Map(); // conversationId -> Uint8Array

// Generates a brand-new random symmetric key for a conversation.
export async function createConversationKey() {
  const sodium = await getSodium();
  return sodium.crypto_secretbox_keygen();
}

// Seals a conversation's symmetric key to one member's public key. The result
// is safe to store server-side — only that member's private key can open it.
export async function wrapKeyForMember(symKey, memberPublicKeyB64) {
  const sodium = await getSodium();
  const memberPublicKey = sodium.from_base64(memberPublicKeyB64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(symKey, memberPublicKey);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

// Opens a member's own wrapped-key row using their identity keypair, returning
// the raw conversation symmetric key.
export async function unwrapKey(wrappedKeyB64, myPublicKey, myPrivateKey) {
  const sodium = await getSodium();
  const sealed = sodium.from_base64(wrappedKeyB64, sodium.base64_variants.ORIGINAL);
  return sodium.crypto_box_seal_open(sealed, myPublicKey, myPrivateKey);
}

export function getCachedConversationKey(conversationId) {
  return sessionKeyCache.get(conversationId) || null;
}

export function setCachedConversationKey(conversationId, symKey) {
  sessionKeyCache.set(conversationId, symKey);
}

export function clearConversationKeyCache() {
  sessionKeyCache.clear();
}

// Convenience: given a member's own wrapped_key row (fetched from
// conversation_keys via RLS, which only ever returns their own row) and their
// loaded identity, returns the usable symmetric key, using the session cache
// when available.
export async function resolveConversationKey(conversationId, wrappedKeyB64, identity) {
  const cached = getCachedConversationKey(conversationId);
  if (cached) return cached;
  const symKey = await unwrapKey(wrappedKeyB64, identity.publicKey, identity.privateKey);
  setCachedConversationKey(conversationId, symKey);
  return symKey;
}
