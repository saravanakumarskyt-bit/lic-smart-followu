// Optional password-protected backups. AES-256-GCM with a key derived from the password via PBKDF2-SHA256.
// Runs on the Web Crypto API in browsers, in Android WebView and in Node 20+.
// There is no password recovery: a lost password means the encrypted backup cannot be opened.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const ENVELOPE_FORMAT = 'lic-smart-followup-encrypted-backup';

export function toBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isEncryptedEnvelope(obj) {
  return !!obj && obj.format === ENVELOPE_FORMAT && typeof obj.data === 'string';
}

/** Encrypt a string. Returns a JSON-serialisable envelope. */
export async function encryptString(plain, password, { iterations = 250000 } = {}) {
  if (!password) throw new Error('A password is required');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return {
    format: ENVELOPE_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-256-GCM', iv: toBase64(iv) },
    data: toBase64(ct),
  };
}

/** Decrypt an envelope. Throws Error('Wrong password or damaged backup file') on any failure. */
export async function decryptEnvelope(envelope, password) {
  if (!isEncryptedEnvelope(envelope)) throw new Error('Not an encrypted backup file');
  try {
    const salt = fromBase64(envelope.kdf.salt);
    const iv = fromBase64(envelope.cipher.iv);
    const key = await deriveKey(password, salt, envelope.kdf.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(envelope.data));
    return dec.decode(pt);
  } catch {
    throw new Error('Wrong password or damaged backup file');
  }
}
