import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCloudConfig } from '../scripts/cloud-config.mjs';

test('optional cloud config supplies only public app and environment IDs to build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'learnski-cloud-'));
  try {
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config', 'cloud.example.json'), JSON.stringify({
      appId: 'touristappid', envId: '', fileIdPrefix: '',
    }));
    assert.deepEqual(await readCloudConfig(root), { appId: 'touristappid', envId: '' });
    await writeFile(join(root, 'config', 'cloud.local.json'), JSON.stringify({
      appId: 'wx-real-id', envId: 'env-real-id', fileIdPrefix: 'private-prefix', secret: 'do-not-ship',
    }));
    assert.deepEqual(await readCloudConfig(root), { appId: 'wx-real-id', envId: 'env-real-id' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
