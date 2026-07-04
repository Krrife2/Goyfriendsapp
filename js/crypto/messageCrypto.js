// Message body encryption/decryption. The server only ever sees the ciphertext
// and nonce produced here — it never sees plaintext or the conversation key.

import { getSodium } from './sodium.js';

export async function encryptMessage(plaintext, symKey) {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintextBytes = sodium.from_string(plaintext);
  const ciphertextBytes = sodium.crypto_secretbox_easy(plaintextBytes, nonce, symKey);
  return {
    ciphertext: sodium.to_base64(ciphertextBytes, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
}

// Returns the decrypted string, or throws if the key/nonce/ciphertext don't
// line up (wrong or missing key, corrupted row). Callers should catch this
// per-message so one bad row never breaks the whole thread render.
export async function decryptMessage(ciphertextB64, nonceB64, symKey) {
  const sodium = await getSodium();
  const ciphertextBytes = sodium.from_base64(ciphertextB64, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(nonceB64, sodium.base64_variants.ORIGINAL);
  const plaintextBytes = sodium.crypto_secretbox_open_easy(ciphertextBytes, nonce, symKey);
  return sodium.to_string(plaintextBytes);
}
