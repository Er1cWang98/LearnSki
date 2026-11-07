import test from 'node:test';
import assert from 'node:assert/strict';
import { getLesson } from '../src/catalog/intro';
import { createRepository } from '../src/server/repository';
import { handleRequest } from '../src/server/entry';
import { createHarness } from './helpers/fakes';
import type { CommitInput } from '../src/domain/types';

async function ready(h: ReturnType<typeof createHarness>, result: CommitInput['result'] = 'selfCompleted') {
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.files.put(ticket.expectedFileId, { bytes: 1024, video: true });
  return { ticket, input: { sessionId: ticket.id, fileId: ticket.expectedFileId, lessonVersion: 1,
    checkedIds: result === 'selfCompleted' ? getLesson('intro-01').criteria.map(x => x.id) : [],
    note: '第一次练习', result } as CommitInput };
}

test('completed check-in is atomic, scoped and idempotent under duplicate requests', async () => {
  const h = createHarness();
  const { ticket, input } = await ready(h);
  const [a, b] = await Promise.all([h.apiA.commit(input), h.apiA.commit(input)]);
  assert.equal(a.record.id, ticket.id);
  assert.equal(a.record.id, b.record.id);
  assert.equal(a.progress.requiredDone, 1);
  assert.equal((await h.repository.listOwned('practices', 'user-a', { limit: 20 })).length, 1);
  assert.equal((await h.apiA.getProgress()).progress.nextLessonId, 'intro-02');
  await assert.rejects(h.apiB.commit(input), { code: 'NOT_FOUND' });
  await assert.rejects(h.apiA.commit({ ...input, result: 'practicing' }), { code: 'CONFLICT' });
});

test('upload tickets use trusted owner, configured file prefix and server expiry', async () => {
  const h = createHarness();
  const a = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  assert.equal(a.cloudPath, `practice/user-a/${a.id}/video`);
  assert.equal(a.expectedFileId, `cloud://test-env.123456/${a.cloudPath}`);
  assert.equal(a.expiresAt, 1_000_000 + 24 * 60 * 60 * 1000);
  assert.notEqual((await h.apiA.getProgress()).scope, (await h.apiB.getProgress()).scope);
});

test('locked lesson, forged version and another owner upload are rejected', async () => {
  const h = createHarness();
  await assert.rejects(h.apiA.createUpload({ lessonId: 'intro-02', lessonVersion: 1 }), { code: 'LESSON_LOCKED' });
  await assert.rejects(h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 2 }), { code: 'VERSION_CHANGED' });
  const { input } = await ready(h);
  await assert.rejects(h.apiB.commit(input), { code: 'NOT_FOUND' });
  await assert.rejects(h.apiA.commit({ ...input, fileId: 'cloud://test-env.123456/practice/user-b/stolen/video' }), { code: 'INVALID_INPUT' });
});

test('missing or invalid video never creates practice or completion', async () => {
  const h = createHarness();
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  const input: CommitInput = { sessionId: ticket.id, fileId: ticket.expectedFileId, lessonVersion: 1,
    checkedIds: ['intro-01-name', 'intro-01-check'], note: '', result: 'selfCompleted' };
  await assert.rejects(h.apiA.commit(input), { code: 'VIDEO_REQUIRED' });
  h.files.put(ticket.expectedFileId, { bytes: 0, video: true });
  await assert.rejects(h.apiA.commit(input), { code: 'VIDEO_INVALID' });
  h.files.put(ticket.expectedFileId, { bytes: 1024, video: false });
  await assert.rejects(h.apiA.commit(input), { code: 'VIDEO_INVALID' });
  assert.equal((await h.apiA.getProgress()).progress.requiredDone, 0);
});

test('transaction failure rolls back all writes; retry then succeeds', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  h.failNextCommit();
  await assert.rejects(h.apiA.commit(input), /injected commit failure/);
  assert.equal((await h.repository.listOwned('practices', 'user-a', { limit: 20 })).length, 0);
  assert.equal((await h.apiA.getProgress()).progress.requiredDone, 0);
  assert.equal((await h.apiA.commit(input)).progress.requiredDone, 1);
});

test('two sessions completing same lesson create one completion and two records', async () => {
  const h = createHarness();
  const first = await ready(h);
  const second = await ready(h);
  const [a, b] = await Promise.all([h.apiA.commit(first.input), h.apiA.commit(second.input)]);
  assert.notEqual(a.record.id, b.record.id);
  assert.equal((await h.repository.listOwned('completions', 'user-a', { limit: 20 })).length, 1);
  assert.equal((await h.repository.listOwned('practices', 'user-a', { limit: 20 })).length, 2);
});

test('expired session and missing identity are rejected', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  h.advanceTime(24 * 60 * 60 * 1000 + 1);
  await assert.rejects(h.apiA.commit(input), { code: 'UPLOAD_EXPIRED' });
  const response = await handleRequest({ action: 'getProgress', input: {} }, { openid: '', service: { forUser: () => h.apiA } });
  assert.deepEqual(response, { ok: false, error: { code: 'UNAUTHENTICATED', message: '请先登录' } });
});

test('RPC rejects unknown actions and prototype properties', async () => {
  const h = createHarness();
  const context = { openid: 'user-a', service: { forUser: () => h.apiA } };
  assert.equal((await handleRequest({ action: '__proto__', input: {} }, context)).ok, false);
  assert.equal((await handleRequest({ action: 'deleteRecord', input: { id: 'x' } }, context)).ok, false);
  assert.equal((await handleRequest({ action: 'getProgress', input: {} }, context)).ok, true);
});

test('RPC does not return raw infrastructure error messages', async () => {
  const context = { openid: 'user-a', service: { forUser: () => ({
    getProgress: async () => { throw Object.assign(new Error('private database path'), { code: 'NETWORK_ERROR' }); },
  }) as any } };
  const response = await handleRequest({ action: 'getProgress', input: {} }, context);
  assert.deepEqual(response, { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接失败，请重试' } });
});

test('a deleted record cannot be resurrected by replaying its upload session', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  await h.apiA.commit(input);
  await h.repository.transaction(tx => tx.remove('practices', input.sessionId));
  await assert.rejects(h.apiA.commit(input), { code: 'RECORD_DELETED' });
});

test('a record pending deletion is not returned by upload replay', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  await h.apiA.commit(input);
  await h.repository.transaction(async tx => {
    const record = await tx.get<Record<string, unknown>>('practices', input.sessionId);
    await tx.set('practices', input.sessionId, { ...record, state: 'deleting', deletionRequestedAt: 1_000_001 });
  });
  await assert.rejects(h.apiA.commit(input), { code: 'RECORD_DELETED' });
});

test('a retry with equivalent JSON field order returns the original record', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  const original = await h.apiA.commit(input);
  const reordered: CommitInput = { result: input.result, note: input.note,
    checkedIds: input.checkedIds, lessonVersion: input.lessonVersion,
    fileId: input.fileId, sessionId: input.sessionId };
  assert.equal((await h.apiA.commit(reordered)).record.id, original.record.id);
});

test('lost response can be retried without inspecting a now unavailable video', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  const original = await h.apiA.commit(input);
  h.files.inspectFailure = new Error('file temporarily unavailable');
  assert.equal((await h.apiA.commit(input)).record.id, original.record.id);
});

test('inspect transport failure propagates without consuming the session', async () => {
  const h = createHarness();
  const { input } = await ready(h);
  h.files.inspectFailure = new Error('storage network down');
  await assert.rejects(h.apiA.commit(input), /storage network down/);
  h.files.inspectFailure = null;
  assert.equal((await h.apiA.commit(input)).progress.requiredDone, 1);
});

test('seeded prerequisite completion unlocks the next lesson for the same owner', async () => {
  const h = createHarness();
  await h.seedCompletions('user-a', [{ lessonId: 'intro-01', lessonVersion: 1,
    firstCompletedAt: 10, sourceRecordId: null }]);
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-02', lessonVersion: 1 });
  assert.equal(ticket.cloudPath.startsWith('practice/user-a/'), true);
  await assert.rejects(h.apiB.createUpload({ lessonId: 'intro-02', lessonVersion: 1 }), { code: 'LESSON_LOCKED' });
});

test('SDK adapter uses document data, preserves thrown errors and callback return', async () => {
  const docs = new Map<string, unknown>();
  const boom = Object.assign(new Error('network offline'), { code: 'NETWORK_ERROR' });
  const db = { runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ collection: (_: string) => ({
    doc: (id: string) => ({ get: async () => { if (id === 'network') throw boom; return { data: docs.get(id) ?? null }; },
      set: async ({ data }: { data: unknown }) => { docs.set(id, data); }, remove: async () => { docs.delete(id); } }),
  }) }), collection: (_: string) => ({ where: () => ({ orderBy: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) }) }) };
  const repository = createRepository(db as unknown as Parameters<typeof createRepository>[0]);
  const value = await repository.transaction(async tx => {
    assert.equal(await tx.get('uploads', 'missing'), null);
    await tx.set('uploads', 'a', { ownerId: 'user-a' });
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(docs.get('a'), { ownerId: 'user-a' });
  await assert.rejects(repository.transaction(tx => tx.get('uploads', 'network')), error => error === boom);
});

test('SDK adapter recognizes only documented missing-document errors', async () => {
  const unexpected = new Error('network says document with _id other does not exist');
  const db = { runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ collection: () => ({
    doc: (id: string) => ({ get: async () => {
      if (id === 'missing') throw new Error('document.get:fail document with _id missing does not exist');
      throw unexpected;
    } }),
  }) }) };
  const repository = createRepository(db as unknown as Parameters<typeof createRepository>[0]);
  assert.equal(await repository.transaction(tx => tx.get('uploads', 'missing')), null);
  await assert.rejects(repository.transaction(tx => tx.get('uploads', 'other')), error => error === unexpected);
});
