import type { CommitInput, LearningApi } from '../../domain/types';

type Response<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function unavailable(): Error & { code: string } {
  return Object.assign(new Error('云服务暂不可用'), { code: 'CLOUD_UNAVAILABLE' });
}

function networkError(): Error & { code: string } {
  return Object.assign(new Error('网络连接失败，请重试'), { code: 'NETWORK_ERROR' });
}

export function createApi(envId: string): LearningApi {
  async function call<T>(action: keyof LearningApi, input: object): Promise<T> {
    if (!envId || typeof wx === 'undefined' || !wx.cloud?.callFunction) throw unavailable();
    let result: unknown;
    try {
      const response = await wx.cloud.callFunction({ name: 'learning', data: { action, input } });
      result = response.result;
    } catch {
      throw networkError();
    }
    if (typeof result !== 'object' || result === null || !('ok' in result)) throw networkError();
    const envelope = result as Response<T>;
    if (envelope.ok === true && 'data' in envelope) return envelope.data;
    if (envelope.ok === false && envelope.error && typeof envelope.error.code === 'string') {
      throw Object.assign(new Error(envelope.error.message || '请求失败'), { code: envelope.error.code });
    }
    throw networkError();
  }

  return {
    getProgress: () => call('getProgress', {}),
    createUpload: input => call('createUpload', input),
    commit: (input: CommitInput) => call('commit', input),
    listRecords: input => call('listRecords', input),
    getRecord: id => call('getRecord', { id }),
    getPlayback: id => call('getPlayback', { id }),
    deleteRecord: id => call('deleteRecord', { id }),
  };
}
