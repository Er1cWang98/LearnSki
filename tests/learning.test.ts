import test from 'node:test';
import assert from 'node:assert/strict';
import { getLesson } from '../src/catalog/intro';
import type { Progress } from '../src/domain/types';
import { createLearningSession, toLessonView, toRouteView } from '../src/miniprogram/presenters/learning';
import { createApi } from '../src/miniprogram/services/cloud';

const emptyProgress: Progress = {
  completedIds: [], requiredDone: 0, requiredTotal: 10,
  nextLessonId: 'intro-01', stageComplete: false,
};

test('unknown cloud progress shows no completed count and only opens the prerequisite-free first lesson', () => {
  const route = toRouteView(null, false);
  assert.equal(route.completedText, '— / 10');
  assert.equal(route.notice, '进度暂不可用');
  assert.equal(route.continueLessonId, 'intro-01');
  const first = toLessonView(getLesson('intro-01'), null);
  const second = toLessonView(getLesson('intro-02'), null);
  assert.equal(first.showFullContent, true);
  assert.equal(second.status, 'unknown');
  assert.equal(second.showFullContent, false);
});

test('trusted progress locks unmet prerequisites and allows completed lessons to be reviewed', () => {
  const locked = toLessonView(getLesson('intro-02'), emptyProgress);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.showFullContent, false);
  const complete = toLessonView(getLesson('intro-02'), {
    ...emptyProgress, completedIds: ['intro-02'], requiredDone: 1,
  });
  assert.equal(complete.status, 'completed');
  assert.equal(complete.showFullContent, true);
  assert.equal(complete.actionLabel, '再练一次');
});

test('optional lesson and next required lesson open together after intro-05', () => {
  const progress = {
    ...emptyProgress,
    completedIds: ['intro-01', 'intro-02', 'intro-03', 'intro-04', 'intro-05'],
    requiredDone: 5, nextLessonId: 'intro-07',
  };
  assert.equal(toLessonView(getLesson('intro-06'), progress).status, 'available');
  assert.equal(toLessonView(getLesson('intro-07'), progress).status, 'available');
  assert.equal(toRouteView(progress, false).continueLessonId, 'intro-07');
});

test('a fresh session ignores old local identity until its own progress request succeeds', async () => {
  const session = createLearningSession({ getProgress: async () => { throw { code: 'NETWORK_ERROR' }; } });
  await session.refresh();
  assert.equal(session.state.progress, null);
  assert.equal(session.state.scope, null);
  assert.equal(session.state.stale, false);
  assert.equal(toRouteView(session.state.progress, session.state.stale).notice, '进度暂不可用');
});

test('verified same-session progress remains visible but marked stale after a later failure', async () => {
  let fail = false;
  const session = createLearningSession({ getProgress: async () => {
    if (fail) throw { code: 'NETWORK_ERROR' };
    return { scope: 'account-a', progress: emptyProgress };
  } });
  await session.refresh();
  assert.equal(session.state.scope, 'account-a');
  fail = true;
  await session.refresh();
  assert.deepEqual(session.state.progress, emptyProgress);
  assert.equal(session.state.stale, true);
  assert.equal(toRouteView(session.state.progress, session.state.stale).notice, '进度未更新');
});

test('confirmed commit progress survives an older in-flight refresh and a later network failure', async () => {
  let release!: (value: { scope: string; progress: Progress }) => void;
  const pending = new Promise<{ scope: string; progress: Progress }>(resolve => { release = resolve; });
  let calls = 0;
  const session = createLearningSession({ getProgress: () => ++calls === 1 ? pending : Promise.reject({ code: 'NETWORK_ERROR' }) });
  const oldRefresh = session.refresh();
  const completed = { ...emptyProgress, completedIds: ['intro-01'], requiredDone: 1, nextLessonId: 'intro-02' };
  session.applyConfirmed('account-a', completed);
  release({ scope: 'account-a', progress: emptyProgress });
  await oldRefresh;
  assert.deepEqual(session.state.progress, completed);
  await session.refresh();
  assert.deepEqual(session.state.progress, completed);
  assert.equal(session.state.stale, true);
});

test('confirmed progress from another account cannot replace the current scoped session', async () => {
  const session = createLearningSession({ getProgress: async () => ({ scope: 'account-b', progress: emptyProgress }) });
  await session.refresh();
  const completed = { ...emptyProgress, completedIds: ['intro-01'], requiredDone: 1 };
  assert.equal(session.applyConfirmed('account-a', completed), false);
  assert.equal(session.state.scope, 'account-b');
  assert.deepEqual(session.state.progress, emptyProgress);
});

test('every unconfigured cloud operation explicitly rejects CLOUD_UNAVAILABLE', async () => {
  const api = createApi('');
  const calls = [
    api.getProgress(),
    api.createUpload({ lessonId: 'intro-01', lessonVersion: 1 }),
    api.commit({ sessionId: 's', fileId: 'f', lessonVersion: 1, checkedIds: [], note: '', result: 'practicing' }),
    api.listRecords({ limit: 20 }), api.getRecord('r'), api.getPlayback('r'), api.deleteRecord('r'),
  ];
  for (const call of calls) await assert.rejects(call, { code: 'CLOUD_UNAVAILABLE' });
});

test('configured cloud progress uses the agreed action/input wire shape', async () => {
  const previousWx = (globalThis as { wx?: unknown }).wx;
  let request: unknown;
  (globalThis as { wx?: unknown }).wx = {
    cloud: { callFunction: async (input: unknown) => {
      request = input;
      return { result: { ok: true, data: { scope: 'account-a', progress: emptyProgress } } };
    } },
  };
  try {
    assert.deepEqual(await createApi('env-1').getProgress(), { scope: 'account-a', progress: emptyProgress });
    assert.deepEqual(request, { name: 'learning', data: { action: 'getProgress', input: {} } });
  } finally {
    (globalThis as { wx?: unknown }).wx = previousWx;
  }
});

test('malformed success envelopes reject NETWORK_ERROR for every cloud method', async () => {
  const previousWx = (globalThis as { wx?: unknown }).wx;
  (globalThis as { wx?: unknown }).wx = {
    cloud: { callFunction: async () => ({ result: { ok: true, data: null } }) },
  };
  try {
    const api = createApi('env-1');
    const calls = [
      () => api.getProgress(),
      () => api.createUpload({ lessonId: 'intro-01', lessonVersion: 1 }),
      () => api.commit({ sessionId: 's', fileId: 'f', lessonVersion: 1, checkedIds: [], note: '', result: 'practicing' }),
      () => api.listRecords({ limit: 20 }),
      () => api.getRecord('r'),
      () => api.getPlayback('r'),
      () => api.deleteRecord('r'),
    ];
    for (const call of calls) await assert.rejects(call(), { code: 'NETWORK_ERROR' });
  } finally {
    (globalThis as { wx?: unknown }).wx = previousWx;
  }
});

test('partial nested success data rejects NETWORK_ERROR without claiming a valid result', async () => {
  const previousWx = (globalThis as { wx?: unknown }).wx;
  const payloads: Record<string, unknown> = {
    getProgress: { scope: 'account-a', progress: { completedIds: [] } },
    createUpload: { id: 'ticket', cloudPath: 'path', expiresAt: 1 },
    commit: { record: {}, progress: emptyProgress },
    listRecords: { items: [{}], nextCursor: null },
    getRecord: { id: 'record' },
    getPlayback: { url: '', expiresAt: 1 },
    deleteRecord: { state: 'gone' },
  };
  (globalThis as { wx?: unknown }).wx = {
    cloud: { callFunction: async (request: { data: { action: string } }) => ({
      result: { ok: true, data: payloads[request.data.action] },
    }) },
  };
  try {
    const api = createApi('env-1');
    const calls = [
      () => api.getProgress(),
      () => api.createUpload({ lessonId: 'intro-01', lessonVersion: 1 }),
      () => api.commit({ sessionId: 's', fileId: 'f', lessonVersion: 1, checkedIds: [], note: '', result: 'practicing' }),
      () => api.listRecords({ limit: 20 }),
      () => api.getRecord('r'),
      () => api.getPlayback('r'),
      () => api.deleteRecord('r'),
    ];
    for (const call of calls) await assert.rejects(call(), { code: 'NETWORK_ERROR' });
  } finally {
    (globalThis as { wx?: unknown }).wx = previousWx;
  }
});

test('well-formed server failure keeps its business code and malformed failure rejects NETWORK_ERROR', async () => {
  const previousWx = (globalThis as { wx?: unknown }).wx;
  let result: unknown = { ok: false, error: { code: 'LESSON_LOCKED', message: '课程未解锁' } };
  (globalThis as { wx?: unknown }).wx = {
    cloud: { callFunction: async () => ({ result }) },
  };
  try {
    const api = createApi('env-1');
    await assert.rejects(api.getProgress(), { code: 'LESSON_LOCKED', message: '课程未解锁' });
    result = { ok: false, error: { code: 5 } };
    await assert.rejects(api.getProgress(), { code: 'NETWORK_ERROR' });
  } finally {
    (globalThis as { wx?: unknown }).wx = previousWx;
  }
});
