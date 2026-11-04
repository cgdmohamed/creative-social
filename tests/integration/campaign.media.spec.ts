import { mkdtemp, writeFile, unlink, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAdvertisingMedia } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.media';
test('owned local storage can be read without HTTP fetching; foreign URLs and traversal are rejected', async () => {
  const before = { ...process.env }, root = await mkdtemp(join(tmpdir(), 'creative-media-test-'));
  const filename = join(root, 'creative.png');
  try {
    await writeFile(filename, 'owned-test-bytes');
    Object.assign(process.env, { FRONTEND_URL: 'https://social.example.test', STORAGE_PROVIDER: 'local', UPLOAD_DIRECTORY: root });
    expect((await readAdvertisingMedia('https://social.example.test/uploads/creative.png')).toString()).toBe('owned-test-bytes');
    await expect(readAdvertisingMedia('https://foreign.example/uploads/creative.png')).rejects.toThrow('configured');
    await expect(readAdvertisingMedia('/uploads/%2e%2e%2fsecret')).rejects.toThrow('path');
    await expect(readAdvertisingMedia('/uploads/creative.png?access_token=secret')).rejects.toThrow('configured');
  } finally { process.env = before; await unlink(filename); await rmdir(root); }
});
