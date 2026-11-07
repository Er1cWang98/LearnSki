import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readCloudConfig(root) {
  const example = JSON.parse(await readFile(join(root, 'config', 'cloud.example.json'), 'utf8'));
  const localPath = join(root, 'config', 'cloud.local.json');
  const local = existsSync(localPath) ? JSON.parse(await readFile(localPath, 'utf8')) : {};
  const appId = local.appId ?? example.appId;
  const envId = local.envId ?? example.envId;
  if (typeof appId !== 'string' || !appId.trim() || typeof envId !== 'string') {
    throw new Error('cloud config requires string appId and envId');
  }
  return { appId, envId };
}
