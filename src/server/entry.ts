import { randomUUID } from 'node:crypto';
import * as cloud from 'wx-server-sdk';
import { createRepository } from './repository';
import { createFileStore } from './files';
import { createService } from './service';
import type { LearningApi } from '../domain/types';

type Service = { forUser(ownerId: string): LearningApi };
type Context = { openid: string | undefined; service: Service };
type RpcResponse = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
type Handler = (api: LearningApi, input: any) => Promise<unknown>;

const actions: Record<string, Handler> = Object.assign(Object.create(null), {
  getProgress: (api: LearningApi) => api.getProgress(),
  createUpload: (api: LearningApi, input: unknown) => api.createUpload(input as Parameters<LearningApi['createUpload']>[0]),
  commit: (api: LearningApi, input: unknown) => api.commit(input as Parameters<LearningApi['commit']>[0]),
  listRecords: (api: LearningApi, input: unknown) => api.listRecords(input as Parameters<LearningApi['listRecords']>[0]),
  getRecord: (api: LearningApi, input: { id: string }) => api.getRecord(input.id),
  getPlayback: (api: LearningApi, input: { id: string }) => api.getPlayback(input.id),
  deleteRecord: (api: LearningApi, input: { id: string }) => api.deleteRecord(input.id),
});

export async function handleRequest(event: unknown, context: Context): Promise<RpcResponse> {
  try {
    if (!context.openid || typeof context.openid !== 'string')
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: '请先登录' } };
    if (!event || typeof event !== 'object' || Array.isArray(event))
      return { ok: false, error: { code: 'INVALID_INPUT', message: '请求格式无效' } };
    const request = event as Record<string, unknown>;
    if (typeof request.action !== 'string' || !Object.prototype.hasOwnProperty.call(actions, request.action) ||
      !request.input || typeof request.input !== 'object' || Array.isArray(request.input))
      return { ok: false, error: { code: 'INVALID_INPUT', message: '请求格式无效' } };
    return { ok: true, data: await actions[request.action](context.service.forUser(context.openid), request.input) };
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code : 'CLOUD_UNAVAILABLE';
    const known = ['CLOUD_UNAVAILABLE', 'UNAUTHENTICATED', 'LESSON_LOCKED', 'VERSION_CHANGED',
      'INVALID_INPUT', 'VIDEO_REQUIRED', 'VIDEO_INVALID', 'UPLOAD_EXPIRED', 'UPLOAD_IN_PROGRESS',
      'CHECKLIST_INCOMPLETE', 'NOT_FOUND', 'RECORD_DELETED', 'CONFLICT', 'NETWORK_ERROR'];
    const safeCode = known.includes(code) ? code : 'CLOUD_UNAVAILABLE';
    const messages: Record<string, string> = {
      CLOUD_UNAVAILABLE: '云服务暂不可用', UNAUTHENTICATED: '请先登录',
      LESSON_LOCKED: '课程尚未解锁', VERSION_CHANGED: '课程内容已更新',
      INVALID_INPUT: '请求内容无效', VIDEO_REQUIRED: '请先上传视频',
      VIDEO_INVALID: '视频无效或超过大小限制', UPLOAD_EXPIRED: '上传会话已过期',
      UPLOAD_IN_PROGRESS: '视频仍在上传中', CHECKLIST_INCOMPLETE: '请完成全部自评项',
      NOT_FOUND: '内容不存在', RECORD_DELETED: '这条记录已删除',
      CONFLICT: '请求与已提交内容冲突', NETWORK_ERROR: '网络连接失败，请重试',
    };
    const message = messages[safeCode];
    return { ok: false, error: { code: safeCode, message } };
  }
}

function fileIdPrefix(prefix: string | undefined, env: string | undefined): string {
  if (!env || !/^[A-Za-z0-9_-]+$/.test(env) ||
    !prefix || !new RegExp(`^cloud://${env}\\.[A-Za-z0-9_-]+$`).test(prefix))
    throw Object.assign(new Error('Invalid FILE_ID_PREFIX'), { code: 'CLOUD_UNAVAILABLE' });
  return prefix;
}

export function createMain(sdk: typeof cloud, environment: NodeJS.ProcessEnv) {
  return async (event: unknown): Promise<RpcResponse> => {
    try {
      sdk.init({ env: sdk.DYNAMIC_CURRENT_ENV as unknown as string });
      const identity = sdk.getWXContext();
      return handleRequest(event, { openid: identity.OPENID, service: {
        forUser(ownerId) {
          const prefix = fileIdPrefix(environment.FILE_ID_PREFIX, identity.ENV);
          return createService({ repository: createRepository(sdk.database()),
            files: createFileStore(sdk as unknown as Parameters<typeof createFileStore>[0]),
            now: Date.now, randomId: randomUUID, fileIdPrefix: prefix }).forUser(ownerId);
        },
      } });
    } catch {
      return { ok: false, error: { code: 'CLOUD_UNAVAILABLE', message: '云服务暂不可用' } };
    }
  };
}

export const main = createMain(cloud, process.env);
