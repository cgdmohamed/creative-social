import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export const stateHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomSecret = () => randomBytes(32).toString('base64url');
export const encryptionConfigured = () => /^[a-fA-F0-9]{64}$/.test(process.env.ADS_ENCRYPTION_KEY || '');
const key = () => {
  const value = process.env.ADS_ENCRYPTION_KEY;
  if (!value || !encryptionConfigured()) throw new Error('Advertising encryption key is not configured');
  return Buffer.from(value, 'hex');
};
export function seal(value: unknown, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function unseal<T>(value: string, context: string): T {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || extra || !iv || !tag || !ciphertext) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Advertising credential decryption failed'); }
}
