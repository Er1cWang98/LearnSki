import { randomUUID } from 'node:crypto';
import * as cloud from 'wx-server-sdk';
import { createFileStore } from './files';
import { runMaintenance } from './maintenance';
import { createRepository } from './repository';

type Response = { ok: true; data: Awaited<ReturnType<typeof runMaintenance>> } |
  { ok: false; error: { code: 'UNAUTHENTICATED' | 'CLOUD_UNAVAILABLE'; message: string } };

export function createMain(sdk: typeof cloud, environment: NodeJS.ProcessEnv, execute = runMaintenance) {
  return async (event: unknown): Promise<Response> => {
    try {
      sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV as unknown as string });
      const identity = sdk.getWXContext();
      if (environment.TRIGGER_SRC !== 'timer' || identity.OPENID || !event || typeof event !== 'object' ||
        Array.isArray(event) || (event as Record<string, unknown>).Type !== 'Timer' ||
        (event as Record<string, unknown>).TriggerName !== 'cleanup-expired')
        return { ok: false, error: { code: 'UNAUTHENTICATED', message: '定时任务身份无效' } };
      const deps = { repository: createRepository(sdk.database()),
        files: createFileStore(sdk as unknown as Parameters<typeof createFileStore>[0]),
        now: Date.now, randomId: randomUUID, fileIdPrefix: '' };
      return { ok: true, data: await execute(deps, 100) };
    } catch {
      return { ok: false, error: { code: 'CLOUD_UNAVAILABLE', message: '云服务暂不可用' } };
    }
  };
}

export const main = createMain(cloud, process.env);
