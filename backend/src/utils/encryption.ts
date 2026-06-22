import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes is standard for GCM

const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
let keyBuffer: Buffer;

// Key Validation Check on Module Import
if (!rawKey) {
  throw new Error('FATAL: TOKEN_ENCRYPTION_KEY environment variable is missing.');
}

if (rawKey.length === 64) {
  // Hex representation of a 32-byte key
  keyBuffer = Buffer.from(rawKey, 'hex');
} else if (rawKey.length === 32) {
  // Plain 32-character UTF-8 key
  keyBuffer = Buffer.from(rawKey, 'utf8');
} else {
  throw new Error(
    `FATAL: TOKEN_ENCRYPTION_KEY must be exactly 32 bytes. Got raw length of ${rawKey.length} characters.`
  );
}

if (keyBuffer.length !== 32) {
  throw new Error(
    `FATAL: TOKEN_ENCRYPTION_KEY resolved to ${keyBuffer.length} bytes, but AES-256 requires exactly 32 bytes.`
  );
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns self-contained format "iv:authTag:ciphertext" (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Encryption process encountered an error.');
  }
}

/**
 * Decrypts a "iv:authTag:ciphertext" formatted string using AES-256-GCM.
 * Reverts back to plaintext. Throws if corrupted or incorrect key.
 */
export function decrypt(encryptedString: string): string {
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format. Expected "iv:authTag:ciphertext".');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}
