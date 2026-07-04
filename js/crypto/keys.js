// Identity keypair generation, on-device storage, and passphrase-protected
// backup/export/import. This is the trust root of the whole E2E system:
// the private key generated here NEVER leaves the browser except inside a
// passphrase-encrypted backup file the user explicitly exports.

import { getSodium } from './sodium.js';

const DB_NAME = 'goyfriends-keystore';
const STORE_NAME = 'identity';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(userId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// In-memory cache of the raw keypair for the current session so we don't
// round-trip IndexedDB (and re-decode base64) on every encrypt/decrypt call.
let cachedIdentity = null; // { userId, publicKey: Uint8Array, privateKey: Uint8Array }

export async function hasLocalIdentity(userId) {
  const record = await idbGet(userId);
  return !!record;
}

export async function loadIdentity(userId) {
  if (cachedIdentity && cachedIdentity.userId === userId) return cachedIdentity;
  const sodium = await getSodium();
  const record = await idbGet(userId);
  if (!record) return null;
  cachedIdentity = {
    userId,
    publicKey: sodium.from_base64(record.publicKeyB64, sodium.base64_variants.ORIGINAL),
    privateKey: sodium.from_base64(record.privateKeyB64, sodium.base64_variants.ORIGINAL),
  };
  return cachedIdentity;
}

// Generates a brand-new X25519 identity keypair for this user on this device
// and persists it to IndexedDB. Returns the public key as base64 so the
// caller can publish it to profiles.public_key.
export async function generateIdentity(userId) {
  const sodium = await getSodium();
  const { publicKey, privateKey } = sodium.crypto_box_keypair();
  const publicKeyB64 = sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const privateKeyB64 = sodium.to_base64(privateKey, sodium.base64_variants.ORIGINAL);
  await idbPut({ userId, publicKeyB64, privateKeyB64, createdAt: new Date().toISOString() });
  cachedIdentity = { userId, publicKey, privateKey };
  return { publicKeyB64 };
}

// Exports the identity private key as a passphrase-encrypted JSON backup the
// user can save and later re-import on a new device. There is deliberately no
// server-side key escrow — that would defeat the E2E guarantee — so losing
// this backup AND the device means permanent loss of that identity's history.
export async function exportBackup(userId, passphrase) {
  const sodium = await getSodium();
  const identity = await loadIdentity(userId);
  if (!identity) throw new Error('No local identity to back up on this device.');

  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const derivedKey = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(identity.privateKey, nonce, derivedKey);

  return {
    version: 1,
    app: 'goyfriends',
    publicKey: sodium.to_base64(identity.publicKey, sodium.base64_variants.ORIGINAL),
    salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
  };
}

// Restores an identity from a backup produced by exportBackup(). Verifies the
// decrypted private key actually matches the published public key before
// trusting/storing it, so a wrong passphrase fails loudly instead of silently
// corrupting local state.
export async function importBackup(userId, backup, passphrase) {
  const sodium = await getSodium();

  const salt = sodium.from_base64(backup.salt, sodium.base64_variants.ORIGINAL);
  const nonce = sodium.from_base64(backup.nonce, sodium.base64_variants.ORIGINAL);
  const ciphertext = sodium.from_base64(backup.ciphertext, sodium.base64_variants.ORIGINAL);
  const expectedPublicKey = sodium.from_base64(backup.publicKey, sodium.base64_variants.ORIGINAL);

  const derivedKey = sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  let privateKey;
  try {
    privateKey = sodium.crypto_secretbox_open_easy(ciphertext, nonce, derivedKey);
  } catch {
    throw new Error('Wrong passphrase, or this backup file is corrupted.');
  }

  const derivedPublicKey = sodium.crypto_scalarmult_base(privateKey);
  if (sodium.to_base64(derivedPublicKey, sodium.base64_variants.ORIGINAL) !== backup.publicKey) {
    throw new Error('Backup does not match the expected identity — refusing to import.');
  }
  if (sodium.to_base64(expectedPublicKey, sodium.base64_variants.ORIGINAL) !== backup.publicKey) {
    // unreachable given the check above, but keeps intent explicit
    throw new Error('Backup public key mismatch.');
  }

  const publicKeyB64 = backup.publicKey;
  const privateKeyB64 = sodium.to_base64(privateKey, sodium.base64_variants.ORIGINAL);
  await idbPut({ userId, publicKeyB64, privateKeyB64, createdAt: new Date().toISOString() });
  cachedIdentity = { userId, publicKey: expectedPublicKey, privateKey };
  return { publicKeyB64 };
}

export function clearIdentityCache() {
  cachedIdentity = null;
}
