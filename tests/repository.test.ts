import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/server/repository';
import { createService } from '../src/server/service';
import { runMaintenance } from '../src/server/maintenance';
import { MemoryFiles } from './helpers/fakes';

// SDK-shaped boundary: reads add _id, while set rejects it just like the pinned SDK.
function sdkDatabase() {
  const docs = new Map<string, Record<string, any>>();
  const orders: Array<Array<[string, string]>> = [];
  const matches = (doc: any, condition: any): boolean => condition.and
    ? condition.and.every((item: any) => matches(doc, item)) : condition.or
      ? condition.or.some((item: any) => matches(doc, item))
      : Object.entries(condition).every(([key, value]: [string, any]) =>
        value && typeof value === 'object' ? ('lt' in value ? doc[key] < value.lt : doc[key] <= value.lte) : doc[key] === value);
  const db = {
    command: { lt: (lt: unknown) => ({ lt }), lte: (lte: unknown) => ({ lte }),
      and: (and: unknown[]) => ({ and }), or: (or: unknown[]) => ({ or }) },
    async runTransaction<T>(run: (tx: any) => Promise<T>) { return run(db); },
    collection(name: string) {
      let condition: any = {}; let limit = Infinity; let offset = 0;
      const sort: Array<[string, string]> = [];
      const query = {
        doc(id: string) { const key = `${name}/${id}`; return {
          async get() { const value = docs.get(key); return { data: value ? { ...structuredClone(value), _id: id } : null }; },
          async set({ data }: { data: any }) { assert.equal('_id' in data, false, 'SDK forbids _id in set'); docs.set(key, structuredClone(data)); },
          async remove() { docs.delete(key); },
        }; },
        where(value: any) { condition = value; return query; },
        orderBy(field: string, direction: string) { sort.push([field, direction]); return query; },
        skip(value: number) { offset = value; return query; },
        limit(value: number) { limit = value; return query; },
        async get() {
          orders.push(sort);
          const rows = [...docs].filter(([key]) => key.startsWith(`${name}/`))
            .map(([key, value]) => ({ ...value, _id: key.slice(name.length + 1) })).filter(row => matches(row, condition));
          rows.sort((a: any, b: any) => { for (const [field, direction] of sort) {
            const comparison = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
            if (comparison) return direction === 'desc' ? -comparison : comparison;
          } return 0; });
          return { data: rows.slice(offset, offset + limit) };
        },
        async count() { return { total: (await query.get()).data.length }; },
      };
      return query;
    },
  };
  return { docs, orders, repository: createRepository(db as any) };
}

test('SDK-shaped reads survive commit, delete completion clearing and expired upload cleanup', async () => {
  const { repository, docs } = sdkDatabase();
  const files = new MemoryFiles(); let now = 1000; let serial = 0;
  const deps = { repository, files, now: () => now, randomId: () => `session-${++serial}`, fileIdPrefix: 'cloud://env.bucket/' };
  const api = createService(deps).forUser('owner');
  const ticket = await api.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  files.put(ticket.expectedFileId, { bytes: 10, video: true });
  const { record } = await api.commit({ sessionId: ticket.id, fileId: ticket.expectedFileId, lessonVersion: 1,
    checkedIds: ['intro-01-name', 'intro-01-check'], note: '', result: 'selfCompleted' });
  assert.equal(docs.get(`uploads/${ticket.id}`)?.state, 'consumed');
  assert.deepEqual(await api.deleteRecord(record.id), { state: 'deleted' });
  assert.equal([...docs].find(([key]) => key.startsWith('completions/'))?.[1].sourceRecordId, null);
  const unused = await api.createUpload({ lessonId: 'intro-01', lessonVersion: 1 });
  now += 24 * 60 * 60 * 1000;
  assert.deepEqual(await runMaintenance(deps, 100), { removed: 1, failed: 0, skipped: 0 });
  assert.equal(docs.get(`uploads/${unused.id}`)?.state, 'expired');
  const caller = { _id: 'reserved', id: 'application-id', state: 'issued' };
  await repository.transaction(tx => tx.set('uploads', 'copy', caller));
  assert.deepEqual(caller, { _id: 'reserved', id: 'application-id', state: 'issued' });
  assert.equal(docs.get('uploads/copy')?.id, 'application-id');
});

test('production cursor combines owner/state/lesson with strict descending time and id', async () => {
  const { repository, docs, orders } = sdkDatabase();
  for (const [id, createdAt, ownerId, lessonId, state] of [
    ['z', 30, 'a', 'one', 'active'], ['c', 20, 'a', 'one', 'active'], ['b', 20, 'a', 'one', 'active'],
    ['a', 10, 'a', 'one', 'active'], ['other-owner', 15, 'b', 'one', 'active'],
    ['other-lesson', 15, 'a', 'two', 'active'], ['hidden', 15, 'a', 'one', 'deleting'],
  ] as const) docs.set(`practices/${id}`, { id, createdAt, ownerId, lessonId, state });
  const options = { lessonId: 'one', state: 'active', limit: 2 };
  const first = await repository.listOwned<any>('practices', 'a', options);
  const second = await repository.listOwned<any>('practices', 'a', { ...options, before: { createdAt: 20, id: 'c' } });
  assert.deepEqual([...first, ...second].map(row => row.id), ['z', 'c', 'b', 'a']);
  assert.deepEqual(orders, [[['createdAt', 'desc'], ['_id', 'desc']], [['createdAt', 'desc'], ['_id', 'desc']]]);
});
