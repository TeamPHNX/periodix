import crypto from 'crypto';
import argon2 from 'argon2';

// Provides hashing and symmetric encryption helpers.

const MASTER_KEY_HEX = process.env.PERIODIX_MASTER_KEY;
if (!MASTER_KEY_HEX) {
    throw new Error('PERIODIX_MASTER_KEY is required');
}
if (!/^[0-9a-fA-F]{64}$/.test(MASTER_KEY_HEX)) {
    throw new Error(
        'PERIODIX_MASTER_KEY must be a 64-character hex string (32 bytes)',
    );
}
const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');

export async function hashPassword(pw: string) {
    return argon2.hash(pw, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16, // 64MB
        timeCost: 3,
        parallelism: 1,
    });
}

export async function verifyPassword(hash: string, pw: string) {
    try {
        return await argon2.verify(hash, pw);
    } catch {
        return false;
    }
}

export interface EncryptedSecret {
    ciphertext: Buffer;
    nonce: Buffer;
    keyVersion: number;
}

export function encryptSecret(plain: string, keyVersion = 1): EncryptedSecret {
    const nonce = crypto.randomBytes(12); // GCM nonce
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, nonce);
    const ciphertext = Buffer.concat([
        cipher.update(plain, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
        ciphertext: Buffer.concat([ciphertext, tag]),
        nonce,
        keyVersion,
    };
}

export function decryptSecret(enc: EncryptedSecret): string {
    const { ciphertext, nonce } = enc;
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return plain.toString('utf8');
}

export function bufferToBase64(b: Buffer | null | undefined) {
    return b ? b.toString('base64') : null;
}
export function base64ToBuffer(s: string | null | undefined) {
    return s ? Buffer.from(s, 'base64') : null;
}
