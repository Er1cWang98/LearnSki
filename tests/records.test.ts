import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordDetailController, createRecordsController } from '../src/miniprogram/presenters/records';
import { completeFirstLesson, createHarness, deferred } from './helpers/fakes';
import type { LearningApi, RecordPage } from '../src/domain/types';

test('empty records and failed network load have distinct states', async () => {
  const h = createHarness();
  const records = createRecordsController(h.apiA);
  await records.load();
  assert.equal(records.getState().phase, 'empty');
  const broken = createRecordsController({ listRecords: async () => { throw { code: 'NETWORK_ERROR' }; },
    deleteRecord: h.apiA.deleteRecord } as Pick<LearningApi, 'listRecords' | 'deleteRecord'>);
  await broken.load();
  assert.equal(broken.getState().phase, 'error');
  assert.equal(broken.getState().error, 'NETWORK_ERROR');
});

test('a late response from an old filter cannot replace the current lesson', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  const old = deferred<RecordPage>();
  const records = createRecordsController({ listRecords: input => input.lessonId === 'intro-01'
    ? old.promise : Promise.resolve({ items: [], nextCursor: null, totalActive: 1 }),
  deleteRecord: h.apiA.deleteRecord });
  const first = records.load('intro-01');
  await records.load('intro-02');
  old.resolve({ items: [record], nextCursor: null, totalActive: 1 });
  await first;
  assert.equal(records.getState().lessonId, 'intro-02');
  assert.equal(records.getState().phase, 'empty');
  assert.deepEqual(records.getState().items, []);
});

test('a late load-more page cannot append into a newer filter', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  const oldPage = deferred<RecordPage>();
  const records = createRecordsController({
    listRecords: input => input.cursor ? oldPage.promise : Promise.resolve({
      items: input.lessonId === 'intro-02' ? [] : [record],
      nextCursor: input.lessonId === 'intro-02' ? null : 'next', totalActive: 1,
    }),
    deleteRecord: h.apiA.deleteRecord,
  });
  await records.load('intro-01');
  const more = records.loadMore();
  await records.load('intro-02');
  oldPage.resolve({ items: [record], nextCursor: null, totalActive: 1 });
  await more;
  assert.equal(records.getState().lessonId, 'intro-02');
  assert.equal(records.getState().phase, 'empty');
  assert.deepEqual(records.getState().items, []);
});

test('deletion updates the active count and removes the row', async () => {
  const h = createHarness();
  await completeFirstLesson(h);
  await completeFirstLesson(h);
  const records = createRecordsController(h.apiA);
  await records.load();
  assert.equal(records.getState().totalActive, 2);
  const id = records.getState().items[0].id;
  assert.deepEqual(await records.remove(id), { state: 'deleted' });
  assert.equal(records.getState().totalActive, 1);
  assert.equal(records.getState().items.some(item => item.id === id), false);
});

test('load more appends the next page without duplicate rows', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  const first = Array.from({ length: 20 }, (_, index) => ({ ...record, id: `record-${index}` }));
  const records = createRecordsController({
    listRecords: async input => input.cursor
      ? { items: [first[0], { ...record, id: 'record-20' }], nextCursor: null, totalActive: 21 }
      : { items: first, nextCursor: 'page-2', totalActive: 21 },
    deleteRecord: h.apiA.deleteRecord,
  });
  await records.load();
  await records.loadMore();
  assert.equal(records.getState().items.length, 21);
  assert.equal(records.getState().nextCursor, null);
  assert.equal(records.getState().totalActive, 21);
});

test('playback refreshes once on video error then requires an explicit retry', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  let playbackCalls = 0;
  const detail = createRecordDetailController({
    getRecord: h.apiA.getRecord,
    getPlayback: async id => { playbackCalls++; return h.apiA.getPlayback(id); },
    deleteRecord: h.apiA.deleteRecord,
  });
  await detail.load(record.id);
  assert.equal(playbackCalls, 1);
  await detail.videoError();
  assert.equal(playbackCalls, 2);
  await detail.videoError();
  assert.equal(playbackCalls, 2);
  assert.equal(detail.getState().playbackError, true);
  await detail.retryPlayback();
  assert.equal(playbackCalls, 3);
  assert.equal(detail.getState().playbackError, false);
});

test('deleting detail reports processing until file removal finishes', async () => {
  const h = createHarness();
  const record = await completeFirstLesson(h);
  const detail = createRecordDetailController(h.apiA);
  await detail.load(record.id);
  h.files.removeFailure = new Error('offline');
  assert.deepEqual(await detail.remove(), { state: 'deleting' });
  assert.equal(detail.getState().phase, 'deleting');
  h.files.removeFailure = null;
  assert.deepEqual(await detail.remove(), { state: 'deleted' });
  assert.equal(detail.getState().phase, 'deleted');
});
