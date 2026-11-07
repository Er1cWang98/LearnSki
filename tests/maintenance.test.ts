import test from 'node:test';
import assert from 'node:assert/strict';
import { getLesson } from '../src/catalog/intro';
import { runMaintenance } from '../src/server/maintenance';
import { createMain } from '../src/server/maintenance-entry';
import { createRepository } from '../src/server/repository';
import { completeFirstLesson, createHarness, deferred } from './helpers/fakes';

const day = 24 * 60 * 60 * 1000;

test('expired unused upload retries removal without touching a completed video', async () => {
  const h = createHarness();
  const saved = await completeFirstLesson(h);
  const savedSession = await h.repository.transaction(tx => tx.get<{ expectedFileId: string }>('uploads', saved.id));
  const unused = await h.apiA.createUpload({ lessonId: 'intro-02', lessonVersion: 1 });
  h.files.put(unused.expectedFileId, { bytes: 1024, video: true });
  h.advanceTime(25 * 60 * 60 * 1000);
  h.files.failNextRemove();
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 1, skipped: 0 });
  assert.equal((await h.repository.transaction(tx => tx.get<{ state: string }>('uploads', unused.id)))?.state, 'cleaning');
  assert.equal(h.files.has(unused.expectedFileId), true);
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
  assert.equal(h.files.has(unused.expectedFileId), false);
  assert.equal(h.files.has(savedSession!.expectedFileId), true);
  assert.equal((await h.apiA.getRecord(saved.id)).id, saved.id);
});

test('unexpired uploads are ignored and an absent expired file is completed idempotently', async () => {
  const h = createHarness();
  const unused = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 0, skipped: 0 });
  h.advanceTime(day);
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
  assert.equal((await h.repository.transaction(tx => tx.get<{ state: string }>('uploads', unused.id)))?.state, 'expired');
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 0, skipped: 0 });
});

test('a stale consumed candidate is skipped after transactional reread', async () => {
  const h = createHarness();
  const saved = await completeFirstLesson(h);
  const session = await h.repository.transaction(tx => tx.get<{ expectedFileId: string }>('uploads', saved.id));
  h.repository.listCleanupCandidates = async () => [{ collection: 'uploads', id: saved.id }];
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 0, skipped: 1 });
  assert.equal(h.files.has(session!.expectedFileId), true);
});

test('failed claim transaction leaves the upload video intact for a later run', async () => {
  const h = createHarness();
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.files.put(ticket.expectedFileId, { bytes: 1024, video: true });
  h.advanceTime(day);
  h.failNextCommit();
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 1, skipped: 0 });
  assert.equal(h.files.has(ticket.expectedFileId), true);
  assert.equal((await h.repository.transaction(tx => tx.get<{ state: string }>('uploads', ticket.id)))?.state, 'issued');
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
});

test('one storage failure does not stop other cleanup candidates', async () => {
  const h = createHarness();
  const first = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  const second = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.files.put(first.expectedFileId, { bytes: 1024, video: true });
  h.files.put(second.expectedFileId, { bytes: 1024, video: true });
  h.advanceTime(day);
  h.files.failNextRemove();
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 1, skipped: 0 });
  assert.equal(Number(h.files.has(first.expectedFileId)) + Number(h.files.has(second.expectedFileId)), 1);
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
});

test('failure logging includes only an anonymized id and safe error code', async () => {
  const h = createHarness();
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.advanceTime(day);
  h.files.removeFailure = Object.assign(new Error('private note'), { code: 'https://private.example/video' });
  const lines: string[] = [];
  const previous = console.error;
  console.error = (value: unknown) => { lines.push(String(value)); };
  try {
    assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 0, failed: 1, skipped: 0 });
  } finally {
    console.error = previous;
  }
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.event, 'maintenance_failure');
  assert.equal(logged.collection, 'uploads');
  assert.match(logged.idHash, /^[a-f0-9]{16}$/);
  assert.equal(logged.code, 'MAINTENANCE_FAILED');
  assert.equal(lines[0].includes(ticket.expectedFileId), false);
  assert.equal(lines[0].includes('private.example'), false);
  assert.equal(lines[0].includes('private note'), false);
});

test('commit and cleanup racing for one session have only one winner', async () => {
  const h = createHarness();
  const ticket = await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.files.put(ticket.expectedFileId, { bytes: 1024, video: true });
  const inspected = deferred<void>();
  const resume = deferred<void>();
  const inspect = h.files.inspect.bind(h.files);
  h.files.inspect = async id => { const media = await inspect(id); inspected.resolve(); await resume.promise; return media; };
  const input = { sessionId: ticket.id, fileId: ticket.expectedFileId, lessonVersion: 1,
    checkedIds: getLesson('intro-01').criteria.map(item => item.id), note: '', result: 'selfCompleted' as const };
  const committing = h.apiA.commit(input);
  await inspected.promise;
  h.advanceTime(day);
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
  resume.resolve();
  await assert.rejects(committing, { code: 'CONFLICT' });
  assert.equal(h.files.has(ticket.expectedFileId), false);
  assert.equal((await h.apiA.listRecords({ limit: 20 })).totalActive, 0);
});

test('maintenance finishes a deleting record and clears its completion reference', async () => {
  const h = createHarness();
  const saved = await completeFirstLesson(h);
  const session = await h.repository.transaction(tx => tx.get<{ expectedFileId: string }>('uploads', saved.id));
  h.files.failNextRemove();
  assert.deepEqual(await h.apiA.deleteRecord(saved.id), { state: 'deleting' });
  assert.deepEqual(await runMaintenance(h.deps, 100), { removed: 1, failed: 0, skipped: 0 });
  assert.equal(h.files.has(session!.expectedFileId), false);
  assert.equal((await h.repository.listOwned<{ sourceRecordId: string | null }>('completions', 'user-a', { limit: 10 }))[0].sourceRecordId, null);
  assert.equal((await h.apiA.getProgress()).progress.requiredDone, 1);
});

test('maintenance processes at most 100 candidates over query pages', async () => {
  const h = createHarness();
  for (let index = 0; index < 115; index++) await h.apiA.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  h.advanceTime(day);
  assert.deepEqual(await runMaintenance(h.deps, 200), { removed: 100, failed: 0, skipped: 0 });
  assert.deepEqual(await runMaintenance(h.deps, 200), { removed: 15, failed: 0, skipped: 0 });
});

test('SDK cleanup query pages issued, cleaning and deleting candidates without dropping rows', async () => {
  type Doc = { _id: string; state: string; expiresAt?: number; deletionRequestedAt?: number };
  const docs: Record<string, Doc[]> = {
    uploads: [...Array.from({ length: 45 }, (_, index) => ({ _id: `issued-${index}`, state: 'issued', expiresAt: 10 })),
      { _id: 'cleaning-1', state: 'cleaning', expiresAt: 10 },
      { _id: 'cleaning-2', state: 'cleaning', expiresAt: 10 },
      { _id: 'future', state: 'issued', expiresAt: 200 }],
    practices: [{ _id: 'deleting-1', state: 'deleting', deletionRequestedAt: 10 },
      { _id: 'deleting-2', state: 'deleting', deletionRequestedAt: 10 }],
  };
  const offsets: number[] = [];
  const db = { command: { lte: (value: number) => ({ lte: value }) },
    collection(name: string) {
      let condition: Record<string, unknown> = {};
      let sort: string[] = [];
      let offset = 0;
      let take = 0;
      const query = {
        where(value: Record<string, unknown>) { condition = value; return query; },
        orderBy(field: string) { sort.push(field); return query; },
        skip(value: number) { offset = value; offsets.push(value); return query; },
        limit(value: number) { take = value; return query; },
        async get() {
          const rows = docs[name].filter(doc => Object.entries(condition).every(([field, expected]) =>
            typeof expected === 'object' ? (doc as any)[field] <= (expected as { lte: number }).lte
              : (doc as any)[field] === expected));
          rows.sort((a, b) => ((a as any)[sort[0]] - (b as any)[sort[0]]) || a._id.localeCompare(b._id));
          return { data: rows.slice(offset, offset + take) };
        },
      };
      return query;
    },
    async runTransaction() { throw new Error('unused'); },
  };
  const repository = createRepository(db as unknown as Parameters<typeof createRepository>[0]);
  const candidates = await repository.listCleanupCandidates(100, 49);
  assert.equal(candidates.length, 49);
  assert.equal(new Set(candidates.map(item => item.id)).size, 49);
  assert.equal(candidates.filter(item => item.collection === 'uploads').length, 47);
  assert.equal(candidates.filter(item => item.collection === 'practices').length, 2);
  assert.equal(offsets.includes(20), true);
});

test('timer event cannot authorize a user invocation or missing provider metadata', async () => {
  let openid = 'user-a';
  let executed = 0;
  const sdk = { DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV', init() {}, getWXContext: () => ({ OPENID: openid }),
    database: () => ({}), deleteFile: async () => ({ fileList: [] }) };
  const event = { Type: 'Timer', TriggerName: 'cleanup-expired' };
  const execute = async () => { executed++; return { removed: 1, failed: 0, skipped: 0 }; };
  const userMain = createMain(sdk as any, { TRIGGER_SRC: 'timer' }, execute);
  assert.equal((await userMain(event)).ok, false);
  openid = '';
  assert.equal((await createMain(sdk as any, {}, execute)(event)).ok, false);
  assert.equal((await userMain({ Type: 'Timer', TriggerName: 'wrong' })).ok, false);
  assert.equal((await userMain({ Type: 'Manual', TriggerName: 'cleanup-expired' })).ok, false);
  assert.equal(executed, 0);
  assert.deepEqual(await userMain(event), { ok: true, data: { removed: 1, failed: 0, skipped: 0 } });
  assert.equal(executed, 1);
});
