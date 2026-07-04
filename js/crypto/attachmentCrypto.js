// Attachment file-content encryption/decryption. Filename and MIME type are
// small strings, so they reuse messageCrypto's encrypt/decrypt (see
// db/storage.js) and are stored in the messages row's
// attachment_name_ciphertext/attachment_name_nonce columns as encrypted JSON
// {name, type}. This module only handles the raw file bytes, which are
// uploaded to Storage as an opaque binary blob (never base64-inflated).
//
// v1 uses single-shot secretbox on the whole file rather than chunking. Fine
// for the file sizes a 6-7 person friend group actually shares; revisit with
// chunked per-block nonces only if large files become a real pain point.

import { getSodium } from './sodium.js';

// Encrypts a file's raw bytes. Returns a single Uint8Array with the nonce
// prepended to the ciphertext, ready to upload as-is.
export async function encryptFileBytes(arrayBuffer, symKey) {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintextBytes = new Uint8Array(arrayBuffer);
  const ciphertextBytes = sodium.crypto_secretbox_easy(plaintextBytes, nonce, symKey);
  const combined = new Uint8Array(nonce.length + ciphertextBytes.length);
  combined.set(nonce, 0);
  combined.set(ciphertextBytes, nonce.length);
  return combined;
}

// Reverses encryptFileBytes: takes the combined nonce+ciphertext bytes
// downloaded from Storage and returns the original plaintext bytes.
export async function decryptFileBytes(combinedBytes, symKey) {
  const sodium = await getSodium();
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = combinedBytes.slice(0, nonceLen);
  const ciphertextBytes = combinedBytes.slice(nonceLen);
  return sodium.crypto_secretbox_open_easy(ciphertextBytes, nonce, symKey);
}
