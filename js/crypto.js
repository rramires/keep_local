// crypto.js — PBKDF2 key derivation + AES-256-GCM encrypt/decrypt via Web Crypto API

const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

export async function deriveKey(password, salt, extractable = false, iterations = PBKDF2_ITERATIONS) {
  if(!Number.isSafeInteger(iterations)||iterations<600000||iterations>5000000)throw new Error('backup.profile');
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(key, plaintext, additionalData, iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))) {
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, ...(additionalData?{additionalData}:{}) },
    key,
    enc.encode(plaintext)
  );
  return { iv, ciphertext };
}

export async function decrypt(key, iv, ciphertext, additionalData) {
  const dec = new TextDecoder();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, ...(additionalData?{additionalData}:{}) },
    key,
    ciphertext
  );
  return dec.decode(plaintext);
}

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(password + arrayToBase64(salt));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayToBase64(new Uint8Array(hashBuffer));
}

export function arrayToBase64(arr) {
  let binary = '';
  for (let i=0;i<arr.length;i+=8192) binary+=String.fromCharCode(...arr.subarray(i,i+8192));
  return btoa(binary);
}

export function base64ToArray(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function arrayBufferToBase64(buffer) {
  return arrayToBase64(new Uint8Array(buffer));
}

export function base64ToArrayBuffer(b64) {
  return base64ToArray(b64).buffer;
}

const KEY_CHECK_TEXT = 'KeepLocal password key check v1';
export async function createKeyCheck(key) {
  const { iv, ciphertext } = await encrypt(key, KEY_CHECK_TEXT);
  return { iv: arrayToBase64(iv), ct: arrayBufferToBase64(ciphertext) };
}
export async function verifyKeyCheck(key, check) {
  try { return await decrypt(key, base64ToArray(check.iv), base64ToArray(check.ct)) === KEY_CHECK_TEXT; }
  catch { return false; }
}
