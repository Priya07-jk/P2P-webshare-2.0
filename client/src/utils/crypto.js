/**
 * Crypto Utilities — Zero-Knowledge Encryption
 *
 * Uses the Web Crypto API (built into all modern browsers).
 * - AES-GCM 256-bit encryption for file chunks
 * - SHA-256 hashing for file integrity verification
 * - Key is NEVER sent to the server — embedded only in the URL #hash
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;

// ─── Key Generation ────────────────────────────────────────────────────────────

/**
 * Generate a new AES-GCM 256-bit key for encrypting file chunks.
 * @returns {Promise<CryptoKey>}
 */
export async function generateKey() {
  return window.crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,        // extractable — we need to export it for the URL hash
    ['encrypt', 'decrypt'],
  );
}

/**
 * Export a CryptoKey to a base64url string (safe for URL hashes).
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportKey(key) {
  const raw = await window.crypto.subtle.exportKey('raw', key);
  return bufferToBase64url(raw);
}

/**
 * Import a base64url string back into a CryptoKey.
 * @param {string} b64
 * @returns {Promise<CryptoKey>}
 */
export async function importKey(b64) {
  const raw = base64urlToBuffer(b64);
  return window.crypto.subtle.importKey(
    'raw',
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,       // not extractable once imported
    ['encrypt', 'decrypt'],
  );
}

// ─── Encryption / Decryption ───────────────────────────────────────────────────

/**
 * Encrypt a chunk of data using AES-GCM.
 * Returns: [12-byte IV][encrypted data] as a single ArrayBuffer.
 * @param {CryptoKey} key
 * @param {ArrayBuffer} chunk
 * @returns {Promise<ArrayBuffer>}
 */
export async function encryptChunk(key, chunk) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    chunk,
  );

  // Prepend IV to ciphertext so receiver can extract it
  const result = new Uint8Array(12 + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), 12);
  return result.buffer;
}

/**
 * Decrypt a chunk of data using AES-GCM.
 * Expects: [12-byte IV][encrypted data]
 * @param {CryptoKey} key
 * @param {ArrayBuffer} encryptedChunk
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptChunk(key, encryptedChunk) {
  const data = new Uint8Array(encryptedChunk);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  return window.crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of an ArrayBuffer.
 * Used to verify file integrity after transfer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} hex string
 */
export async function hashBuffer(buffer) {
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hashBuffer);
}

/**
 * Compute SHA-256 hash of a File object.
 * @param {File} file
 * @returns {Promise<string>} hex string
 */
export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  return hashBuffer(buffer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
