import { EncryptedVaultPayload } from '../types';

// Convert ArrayBuffer to Base64
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Derive AES-GCM Key using PBKDF2 with 100,000 iterations
async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts an arbitrary object using AES-256-GCM derived from the user's master password.
 */
export async function encryptVault(data: any, masterPassword: string): Promise<EncryptedVaultPayload> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterPassword, salt);

  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    plaintext
  );

  return {
    version: 1,
    salt: bufferToBase64(salt.buffer),
    iv: bufferToBase64(iv.buffer),
    ciphertext: bufferToBase64(ciphertext),
    updatedAt: Date.now(),
  };
}

/**
 * Decrypts an encrypted vault payload using the user's master password.
 */
export async function decryptVault<T = any>(
  payload: EncryptedVaultPayload,
  masterPassword: string
): Promise<T> {
  const salt = new Uint8Array(base64ToBuffer(payload.salt));
  const iv = new Uint8Array(base64ToBuffer(payload.iv));
  const ciphertext = base64ToBuffer(payload.ciphertext);

  const key = await deriveKey(masterPassword, salt);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
      },
      key,
      ciphertext
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted)) as T;
  } catch (err) {
    throw new Error('Invalid master password or corrupted vault payload');
  }
}
