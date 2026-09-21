/**
 * Password hashing and secret encryption.
 *
 * Two very different jobs, deliberately kept apart:
 *
 *  - Passwords are hashed with scrypt and a per-user random salt. Hashing is
 *    one-way: we can check a password but never recover it. The previous
 *    single-user build used a bare SHA-256, which is far too fast to be safe
 *    for stored credentials — scrypt is deliberately slow and memory-hard.
 *
 *  - Notion tokens must be *recoverable*, because we have to send them to
 *    Notion on the user's behalf. So they are encrypted (AES-256-GCM), not
 *    hashed. GCM is authenticated, so tampering is detected rather than
 *    silently decrypting to garbage.
 *
 * Node-only (`node:crypto` scrypt has no Web Crypto equivalent), so anything
 * importing this must run on the Node.js runtime, not the edge.
 */
import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
const KEYLEN = 64;

/** Returns `scrypt$<saltHex>$<hashHex>` — salt travels with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  // Constant-time: never let response timing reveal how much of the hash matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Notion tokens
// ---------------------------------------------------------------------------

/**
 * 32-byte key from ENCRYPTION_KEY (64 hex chars). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Rotating this key makes every stored Notion token undecryptable, and users
 * have to reconnect. That is the intended failure mode: better to lose the
 * tokens than to keep them readable.
 */
function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${key.length} bytes`);
  }
  return key;
}

export type Sealed = { ciphertext: string; iv: string; tag: string };

export function sealToken(plaintext: string): Sealed {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function openToken(sealed: Sealed): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(sealed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** True when the server is configured well enough to hold secrets. */
export function hasEncryptionKey(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
