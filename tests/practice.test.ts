import assert from 'node:assert/strict';
import test from 'node:test';
import { getLesson } from '../src/catalog/intro';
import { createPracticeHarness } from './helpers/fakes';
import { deferred } from './helpers/fakes';
import { createPracticeController } from '../src/miniprogram/presenters/practice';
import { createDraftStore } from '../src/miniprogram/services/drafts';
import type { CommitInput } from '../src/domain/types';

test('commit stays pending until the server confirms and duplicate taps share it', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  h.controller.setChecked(getLesson('intro-01').criteria.map(item => item.id));
  const first = h.controller.submit('selfCompleted');
  const second = h.controller.submit('selfCompleted');
  await h.untilPhase('submitting');
  await h.untilCommit();
  assert.equal(h.state().recordId, null);
  assert.notEqual(h.state().phase, 'success');
  assert.equal(h.commits.length, 1);
  h.resolveCommit();
  await Promise.all([first, second]);
  assert.equal(h.state().phase, 'success');
  assert.equal(h.commits.length, 1);
  assert.equal(h.stored.size, 0);
});

test('cancelled upload ignores a late adapter callback and keeps the form', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  h.controller.setNote('保留心得');
  const upload = deferred<string>();
  const started = deferred<void>();
  let aborted = false;
  h.media.startUpload = (ticket: { expectedFileId: string }) => { started.resolve(); return { promise: upload.promise, abort() { aborted = true; } }; };
  const choosing = h.controller.choose('album');
  await h.untilPhase('uploading');
  await started.promise;
  h.controller.cancelUpload();
  upload.resolve('late-file');
  await choosing;
  assert.equal(aborted, true);
  assert.equal(h.state().phase, 'editing');
  assert.equal(h.state().note, '保留心得');
  assert.equal(h.state().recordId, null);
});

test('a lost commit response retries the frozen input on the same session', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  const original = h.api.commit;
  let calls = 0;
  h.api.commit = async input => {
    const response = await original(input);
    if (++calls === 1) throw Object.assign(new Error('lost'), { code: 'NETWORK_ERROR' });
    return response;
  };
  h.resolveCommit();
  await h.controller.submit('practicing');
  assert.equal(h.state().phase, 'editing');
  assert.equal(h.state().error, 'NETWORK_ERROR');
  h.controller.setNote('must stay frozen');
  await h.controller.submit('selfCompleted');
  assert.equal(h.state().phase, 'success');
  assert.equal(h.state().result, 'practicing');
  assert.equal(h.commits.length, 2);
  assert.equal(h.commits[0], h.commits[1]);
});

test('partial checklist permits saved practice but blocks self completion', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  await h.controller.submit('selfCompleted');
  assert.equal(h.state().error, 'CHECKLIST_INCOMPLETE');
  assert.equal(h.commits.length, 0);
  h.resolveCommit();
  await h.controller.submit('practicing');
  assert.equal(h.state().result, 'practicing');
});

test('notes count Unicode code points and stop at 500', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  h.controller.setNote('雪'.repeat(499) + '🏂' + '多');
  assert.equal([...h.state().note].length, 500);
  assert.equal(h.state().note.endsWith('🏂'), true);
});

test('a newer bundled lesson preserves note and video but requires checklist reconfirmation', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  h.controller.setNote('观察重心');
  h.controller.setChecked(['intro-01-name']);
  await h.controller.dispose();
  const newer = { ...getLesson('intro-01'), version: 2 };
  const restored = createPracticeController({ api: h.api, media: h.media, drafts: h.drafts, lesson: newer,
    scope: 'scope-a', onChange() {} });
  await restored.ready;
  assert.equal(restored.getState().note, '观察重心');
  assert.equal(restored.getState().video?.path, 'wxfile://clip.mp4');
  assert.deepEqual(restored.getState().checkedIds, []);
  assert.equal(restored.getState().needsReconfirmation, true);
  await restored.submit('practicing');
  assert.equal(restored.getState().needsReconfirmation, true);
  assert.equal(restored.getState().error, 'RUBRIC_RECONFIRM');
  await restored.dispose();
  const reopened = createPracticeController({ api: h.api, media: h.media, drafts: h.drafts, lesson: newer,
    scope: 'scope-a', onChange() {} });
  await reopened.ready;
  assert.equal(reopened.getState().needsReconfirmation, true);
  reopened.confirmRubric();
  assert.equal(reopened.getState().needsReconfirmation, false);
  await reopened.submit('practicing');
  assert.equal(reopened.getState().error, 'VIDEO_REQUIRED');
});

test('draft store isolates accounts and clears an expired temporary path but keeps a submit snapshot', async () => {
  const storage = new Map<string, unknown>();
  const wxApi = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => { storage.set(key, value); },
    removeStorageSync: (key: string) => { storage.delete(key); },
    getFileSystemManager: () => ({ access: ({ fail }: { fail: () => void }) => fail() }),
  } as unknown as typeof wx;
  const drafts = createDraftStore(wxApi);
  const source = { lessonVersion: 1, checkedIds: ['intro-01-name'], note: '保留',
    video: { path: 'wxfile://gone.mp4', bytes: 42, duration: 10 },
    ticket: { id: 'session', cloudPath: 'private', expectedFileId: 'file', expiresAt: 99999 }, fileId: 'file',
    snapshot: { sessionId: 'session', fileId: 'file', lessonVersion: 1, checkedIds: ['intro-01-name'], note: '保留', result: 'practicing' as const },
    versionBlocked: false };
  await drafts.save('account-a', 'intro-01', source);
  assert.equal(await drafts.load('account-b', 'intro-01'), null);
  assert.equal(await drafts.load(null, 'intro-01'), null);
  const recovered = await drafts.load('account-a', 'intro-01');
  assert.equal(recovered?.video, null);
  assert.equal(recovered?.snapshot?.sessionId, 'session');
  await drafts.remove('account-a', 'intro-01');
  assert.equal(await drafts.load('account-a', 'intro-01'), null);
});

test('upload failure leaves the selected video available for a fresh ticket retry', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  const original = h.media.startUpload;
  h.media.startUpload = () => ({ promise: Promise.reject({ code: 'NETWORK_ERROR' }), abort() {} });
  await h.controller.choose('album');
  assert.equal(h.state().phase, 'editing');
  assert.equal(h.state().video?.path, 'wxfile://clip.mp4');
  assert.equal(h.state().error, 'NETWORK_ERROR');
  h.media.startUpload = original;
  await h.controller.retryUpload();
  assert.equal(h.state().uploaded, true);
});

test('version error when requesting a ticket blocks stale rubric upload', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  let attempts = 0;
  h.api.createUpload = async () => { attempts += 1; throw { code: 'VERSION_CHANGED' }; };
  await h.controller.choose('album');
  await h.controller.retryUpload();
  assert.equal(h.state().versionBlocked, true);
  assert.equal(attempts, 1);
});

test('confirmed commit stays successful when local draft removal fails', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  h.drafts.remove = async () => { throw new Error('storage unavailable'); };
  h.resolveCommit();
  await h.controller.submit('practicing');
  assert.equal(h.state().phase, 'success');
  assert.ok(h.state().recordId);
});

test('leaving during draft restoration does not overwrite the saved draft with an empty form', async () => {
  const gate = deferred<Awaited<ReturnType<ReturnType<typeof createPracticeHarness>['drafts']['load']>>>();
  const h = createPracticeHarness();
  const saved = { lessonVersion: 1, checkedIds: ['intro-01-name'], note: '之前的心得', video: null,
    ticket: null, fileId: null, snapshot: null, versionBlocked: false };
  h.stored.set('scope-a:intro-01', saved);
  h.drafts.load = () => gate.promise;
  const controller = createPracticeController({ api: h.api, media: h.media, drafts: h.drafts,
    lesson: getLesson('intro-01'), scope: 'scope-a', onChange() {} });
  const leaving = controller.dispose();
  gate.resolve(saved);
  await leaving;
  assert.equal(h.stored.get('scope-a:intro-01')?.note, '之前的心得');
});

test('without a trusted scope, choosing a video keeps only a memory draft and never requests an upload ticket', async () => {
  const h = createPracticeHarness();
  let requests = 0;
  h.api.createUpload = async () => { requests += 1; throw new Error('unexpected'); };
  const controller = createPracticeController({ api: h.api, media: h.media, drafts: h.drafts,
    lesson: getLesson('intro-01'), scope: null, onChange() {} });
  await controller.ready;
  await controller.choose('album');
  assert.equal(requests, 0);
  assert.equal(controller.getState().video?.path, 'wxfile://clip.mp4');
  assert.equal(controller.getState().error, 'CLOUD_UNAVAILABLE');
  assert.equal(h.stored.get('null:intro-01')?.video?.path, 'wxfile://clip.mp4');
});

test('editing after an uncertain commit starts a new session before the next submission', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  const original = h.api.commit;
  let first = true;
  h.api.commit = async input => {
    const result = await original(input);
    if (first) { first = false; throw { code: 'NETWORK_ERROR' }; }
    return result;
  };
  h.resolveCommit();
  await h.controller.submit('practicing');
  h.controller.beginEdit();
  h.controller.setNote('new attempt');
  await h.controller.retryUpload();
  await h.controller.submit('practicing');
  assert.equal(h.state().phase, 'success');
  assert.equal(h.commits.length, 2);
  assert.notEqual(h.commits[0], h.commits[1]);
});

test('upload progress callback remains visible when the adapter reports synchronously', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  const uploading = deferred<string>();
  const started = deferred<void>();
  h.media.startUpload = (_ticket, _video, onProgress) => {
    onProgress(37);
    started.resolve();
    return { promise: uploading.promise, abort() {} };
  };
  const choosing = h.controller.choose('album');
  await started.promise;
  assert.equal(h.state().percent, 37);
  h.controller.cancelUpload();
  uploading.resolve('ignored');
  await choosing;
});

test('cancel while saving a selected video prevents a stale upload ticket request', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  const saving = deferred<void>();
  const saved = deferred<void>();
  const originalSave = h.drafts.save;
  h.drafts.save = async (scope, lessonId, draft) => {
    if (draft.video && !draft.ticket) { saved.resolve(); await saving.promise; }
    await originalSave(scope, lessonId, draft);
  };
  let tickets = 0;
  const originalCreate = h.api.createUpload;
  h.api.createUpload = async input => { tickets += 1; return originalCreate(input); };
  const choosing = h.controller.choose('album');
  await saved.promise;
  h.controller.cancelUpload();
  saving.resolve();
  await choosing;
  assert.equal(tickets, 0);
});

test('draft write failure before commit restores editing and retries the exact frozen submission', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  await h.controller.choose('album');
  h.controller.setNote('原始心得');
  h.controller.setChecked(['intro-01-name']);
  const originalSession = h.stored.get('scope-a:intro-01')?.ticket?.id;
  const originalFileId = h.stored.get('scope-a:intro-01')?.fileId;
  const originalSave = h.drafts.save;
  let failed = false;
  h.drafts.save = async (scope, lessonId, draft) => {
    if (draft.snapshot && !failed) { failed = true; throw new Error('storage full'); }
    await originalSave(scope, lessonId, draft);
  };
  await h.controller.submit('practicing');
  assert.equal(h.state().phase, 'editing');
  assert.equal(h.state().frozen, true);
  assert.equal(h.state().error, 'DRAFT_SAVE_FAILED');
  assert.equal(h.commits.length, 0);
  h.controller.setNote('must not replace snapshot');
  const committed: CommitInput[] = [];
  const originalCommit = h.api.commit;
  h.api.commit = async input => { committed.push(structuredClone(input)); return originalCommit(input); };
  h.resolveCommit();
  await h.controller.submit('selfCompleted');
  assert.equal(h.state().phase, 'success');
  assert.equal(h.commits.length, 1);
  assert.equal(committed[0]?.sessionId, originalSession);
  assert.equal(committed[0]?.fileId, originalFileId);
  assert.equal(committed[0]?.lessonVersion, 1);
  assert.equal(committed[0]?.note, '原始心得');
  assert.deepEqual(committed[0]?.checkedIds, ['intro-01-name']);
  assert.equal(committed[0]?.result, 'practicing');
  assert.equal(h.state().result, 'practicing');
  assert.equal(h.state().recordId !== null, true);
});

test('autosave and disposal failures do not throw or leave an unhandled rejection', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  h.drafts.save = () => { throw new Error('storage unavailable'); };
  assert.doesNotThrow(() => h.controller.setNote('保留在内存'));
  await Promise.resolve();
  assert.equal(h.state().note, '保留在内存');
  assert.equal(h.state().error, 'DRAFT_SAVE_FAILED');
  await assert.doesNotReject(h.controller.dispose());
});

test('draft write failure after selecting a file prevents upload and keeps the selection actionable', async () => {
  const h = createPracticeHarness();
  await h.controller.ready;
  const originalSave = h.drafts.save;
  let failed = false;
  h.drafts.save = async (scope, lessonId, draft) => {
    if (draft.video && !failed) { failed = true; throw new Error('storage full'); }
    await originalSave(scope, lessonId, draft);
  };
  let tickets = 0;
  const originalCreate = h.api.createUpload;
  h.api.createUpload = async input => { tickets += 1; return originalCreate(input); };
  await h.controller.choose('album');
  assert.equal(h.state().phase, 'editing');
  assert.equal(h.state().error, 'DRAFT_SAVE_FAILED');
  assert.equal(h.state().video?.path, 'wxfile://clip.mp4');
  assert.equal(tickets, 0);
  await h.controller.retryUpload();
  assert.equal(h.state().uploaded, true);
});

test('failed draft restoration blocks a fresh upload and leaves cleanup nonrejecting', async () => {
  const h = createPracticeHarness();
  h.drafts.load = async () => { throw new Error('storage read failed'); };
  let requests = 0;
  h.api.createUpload = async () => { requests += 1; throw new Error('unexpected'); };
  const controller = createPracticeController({ api: h.api, media: h.media, drafts: h.drafts,
    lesson: getLesson('intro-01'), scope: 'scope-a', onChange() {} });
  await controller.ready;
  assert.equal(controller.getState().error, 'DRAFT_LOAD_FAILED');
  await controller.choose('album');
  assert.equal(requests, 0);
  assert.equal(controller.getState().video, null);
  await assert.doesNotReject(controller.dispose());
});
