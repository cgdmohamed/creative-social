import { BadRequestException } from '@nestjs/common';
import { readFile, realpath, stat } from 'fs/promises';
import { resolve, sep } from 'path';
const maximum = 50 * 1024 * 1024;
function storedKey(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) throw new BadRequestException('Media path is outside configured storage');
  let key: string;
  try { key = decodeURIComponent(pathname.slice(prefix.length)); } catch { throw new BadRequestException('Invalid media path'); }
  if (!key || key.includes('\\') || key.includes('\0') || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new BadRequestException('Invalid media path');
  return key;
}
// Read an already-authorized workspace Media record from configured storage.
// No arbitrary URL fetching, redirects or client-supplied filesystem paths.
export async function readAdvertisingMedia(mediaPath: string): Promise<Buffer> {
  if ((process.env.STORAGE_PROVIDER || 'local') === 'local') {
    const frontend = new URL(process.env.FRONTEND_URL!);
    const url = new URL(mediaPath, frontend);
    if (url.origin !== frontend.origin || url.username || url.password || url.search || url.hash) throw new BadRequestException('Media does not belong to configured local storage');
    const key = storedKey(url.pathname, '/uploads/');
    if (!process.env.UPLOAD_DIRECTORY) throw new BadRequestException('Local upload directory is not configured');
    const root = await realpath(resolve(process.env.UPLOAD_DIRECTORY));
    const filename = await realpath(resolve(root, ...key.split('/')));
    if (!filename.startsWith(root + sep)) throw new BadRequestException('Media resolved outside upload storage');
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.size > maximum) throw new BadRequestException('Advertising media must be a file up to 50 MiB');
    return readFile(filename);
  }
  if (process.env.STORAGE_PROVIDER !== 'cloudflare') throw new BadRequestException('Unsupported configured media storage');
  const bucket = new URL(process.env.CLOUDFLARE_BUCKET_URL!);
  const url = new URL(mediaPath);
  if (url.origin !== bucket.origin || url.username || url.password || url.search || url.hash) throw new BadRequestException('Media does not belong to configured cloud storage');
  const key = storedKey(url.pathname, bucket.pathname.replace(/\/$/, '') + '/');
  if (!/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID || '')) throw new BadRequestException('Cloud storage account is not configured');
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.CLOUDFLARE_REGION || 'auto', endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY!, secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY! } });
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_BUCKETNAME, Key: key }));
    if (!result.Body || (result.ContentLength || 0) > maximum) throw new BadRequestException('Advertising media exceeds 50 MiB or is unavailable');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > maximum) throw new BadRequestException('Advertising media exceeds 50 MiB'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  } finally { client.destroy(); }
}
