// Session/identity auth (Supabase email magic-link) plus a client-side-only
// WebAuthn "local unlock" gate for fast re-entry. The WebAuthn step never
// talks to Supabase — it's purely a local convenience gate on top of an
// already-valid Supabase session, not a server-recognized second factor.

import { sb } from './supabaseClient.js';

const UNLOCK_CREDENTIAL_KEY = 'goyfriends.unlockCredentialId';
const UNLOCK_ENROLLED_KEY = 'goyfriends.unlockEnrolled';

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

// For a returning invited user whose session has fully expired (refresh token
// no longer valid). Does NOT create new accounts — only Kent's local invite
// script (scripts/invite-user.mjs) can do that, via the service_role key.
export async function requestMagicLink(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

export async function signOut() {
  await sb.auth.signOut();
  localStorage.removeItem(UNLOCK_CREDENTIAL_KEY);
  localStorage.removeItem(UNLOCK_ENROLLED_KEY);
}

// ---- WebAuthn local unlock ----

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

export function isWebAuthnAvailable() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

export function isLocalUnlockEnrolled() {
  return localStorage.getItem(UNLOCK_ENROLLED_KEY) === 'true';
}

// Registers a platform authenticator (Face ID / Touch ID / Windows Hello)
// credential purely for locally gating app re-entry. userId/userName are used
// only to label the credential in the OS's credential picker.
export async function enrollLocalUnlock(userId, userName) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Goyfriends' },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  localStorage.setItem(UNLOCK_CREDENTIAL_KEY, bufferToBase64Url(credential.rawId));
  localStorage.setItem(UNLOCK_ENROLLED_KEY, 'true');
}

// Prompts Face ID/Touch ID/Windows Hello. Resolves true on success, false if
// the user cancels or verification fails. This only proves "the person
// holding this device passed a local biometric/PIN check" — it does not
// re-authenticate to Supabase.
export async function verifyLocalUnlock() {
  const credentialIdB64 = localStorage.getItem(UNLOCK_CREDENTIAL_KEY);
  if (!credentialIdB64) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: base64UrlToBuffer(credentialIdB64), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export function disableLocalUnlock() {
  localStorage.removeItem(UNLOCK_CREDENTIAL_KEY);
  localStorage.removeItem(UNLOCK_ENROLLED_KEY);
}
