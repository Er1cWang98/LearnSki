import type { CommitInput, Criterion, LearningApi, PracticeRecord, Progress, RecordPage, UploadTicket } from '../../domain/types';

type Guard<T> = (value: unknown) => value is T;
type ProgressResult = Awaited<ReturnType<LearningApi['getProgress']>>;
type CommitResult = Awaited<ReturnType<LearningApi['commit']>>;
type PlaybackResult = Awaited<ReturnType<LearningApi['getPlayback']>>;
type DeleteResult = Awaited<ReturnType<LearningApi['deleteRecord']>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCriterion(value: unknown): value is Criterion {
  return isObject(value) && isNonemptyString(value.id) && typeof value.text === 'string';
}

function isProgress(value: unknown): value is Progress {
  return isObject(value) && isStringArray(value.completedIds) &&
    isNumber(value.requiredDone) && isNumber(value.requiredTotal) &&
    (value.nextLessonId === null || typeof value.nextLessonId === 'string') &&
    typeof value.stageComplete === 'boolean';
}

function isProgressResult(value: unknown): value is ProgressResult {
  return isObject(value) && isNonemptyString(value.scope) && isProgress(value.progress);
}

function isUploadTicket(value: unknown): value is UploadTicket {
  return isObject(value) && isNonemptyString(value.id) &&
    isNonemptyString(value.cloudPath) && isNonemptyString(value.expectedFileId) &&
    isNumber(value.expiresAt);
}

function isPracticeRecord(value: unknown): value is PracticeRecord {
  return isObject(value) && isNonemptyString(value.id) &&
    isNonemptyString(value.lessonId) && isNumber(value.lessonVersion) &&
    Array.isArray(value.criteriaSnapshot) && value.criteriaSnapshot.every(isCriterion) &&
    isStringArray(value.checkedIds) && typeof value.note === 'string' &&
    (value.result === 'practicing' || value.result === 'selfCompleted') &&
    isNumber(value.createdAt);
}

function isCommitResult(value: unknown): value is CommitResult {
  return isObject(value) && isPracticeRecord(value.record) && isProgress(value.progress);
}

function isRecordPage(value: unknown): value is RecordPage {
  return isObject(value) && Array.isArray(value.items) &&
    value.items.every(isPracticeRecord) &&
    (value.nextCursor === null || typeof value.nextCursor === 'string') &&
    Number.isSafeInteger(value.totalActive) && (value.totalActive as number) >= 0;
}

function isPlaybackResult(value: unknown): value is PlaybackResult {
  return isObject(value) && isNonemptyString(value.url) && isNumber(value.expiresAt);
}

function isDeleteResult(value: unknown): value is DeleteResult {
  return isObject(value) && (value.state === 'deleted' || value.state === 'deleting');
}

function unavailable(): Error & { code: string } {
  return Object.assign(new Error('云服务暂不可用'), { code: 'CLOUD_UNAVAILABLE' });
}

function networkError(): Error & { code: string } {
  return Object.assign(new Error('网络连接失败，请重试'), { code: 'NETWORK_ERROR' });
}

export function createApi(envId: string): LearningApi {
  async function call<T>(action: keyof LearningApi, input: object, validate: Guard<T>): Promise<T> {
    if (!envId || typeof wx === 'undefined' || !wx.cloud?.callFunction) throw unavailable();
    let result: unknown;
    try {
      const response = await wx.cloud.callFunction({ name: 'learning', data: { action, input } });
      result = response.result;
    } catch {
      throw networkError();
    }
    if (!isObject(result)) throw networkError();
    if (result.ok === true && validate(result.data)) return result.data;
    if (result.ok === false && isObject(result.error) &&
      isNonemptyString(result.error.code) && typeof result.error.message === 'string') {
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    throw networkError();
  }

  return {
    getProgress: () => call('getProgress', {}, isProgressResult),
    createUpload: input => call('createUpload', input, isUploadTicket),
    commit: (input: CommitInput) => call('commit', input, isCommitResult),
    listRecords: input => call('listRecords', input, isRecordPage),
    getRecord: id => call('getRecord', { id }, isPracticeRecord),
    getPlayback: id => call('getPlayback', { id }, isPlaybackResult),
    deleteRecord: id => call('deleteRecord', { id }, isDeleteResult),
  };
}
