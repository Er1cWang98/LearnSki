import test from 'node:test';
import assert from 'node:assert/strict';
import { getProgress, isUnlocked } from '../src/domain/progress';
import type { Completion } from '../src/domain/types';

const completed = (id: string, sourceRecordId: string | null = null): Completion => ({
  lessonId: id, lessonVersion: 1, firstCompletedAt: 1, sourceRecordId,
});

test('首课在空进度下开放并成为下一课', () => {
  assert.equal(isUnlocked('intro-01', []), true);
  assert.equal(isUnlocked('intro-02', []), false);
  assert.deepEqual(getProgress([]), {
    completedIds: [], requiredDone: 0, requiredTotal: 10,
    nextLessonId: 'intro-01', stageComplete: false,
  });
});

test('选修不阻塞必修，重复完成不增加进度', () => {
  const ids = ['intro-01', 'intro-02', 'intro-03', 'intro-04', 'intro-05'];
  assert.equal(isUnlocked('intro-06', ids), true);
  assert.equal(isUnlocked('intro-07', ids), true);
  assert.equal(isUnlocked('intro-08', ids), false);
  const progress = getProgress([...ids, 'intro-05', 'intro-06'].map(id => completed(id)));
  assert.equal(progress.requiredDone, 5);
  assert.equal(progress.requiredTotal, 10);
  assert.equal(progress.nextLessonId, 'intro-07');
});

test('全部必修完成后阶段完成，不要求选修完成', () => {
  const ids = ['intro-01', 'intro-02', 'intro-03', 'intro-04', 'intro-05',
    'intro-07', 'intro-08', 'intro-09', 'intro-10', 'intro-11'];
  const progress = getProgress(ids.map(id => completed(id)));
  assert.equal(progress.requiredDone, 10);
  assert.equal(progress.requiredTotal, 10);
  assert.equal(progress.nextLessonId, null);
  assert.equal(progress.stageComplete, true);
});

test('删除来源记录后完成凭证仍解锁下一课', () => {
  const ids = ['intro-01', 'intro-02'];
  const progress = getProgress([completed('intro-01', null), completed('intro-02', 'deleted-record')]);
  assert.equal(isUnlocked('intro-03', ids), true);
  assert.equal(progress.requiredDone, 2);
  assert.equal(progress.nextLessonId, 'intro-03');
});

test('未知完成凭证不计入进度，未知课程不可查询解锁', () => {
  const progress = getProgress([completed('unknown'), completed('intro-01')]);
  assert.deepEqual(progress.completedIds, ['intro-01']);
  assert.equal(progress.requiredDone, 1);
  assert.throws(() => isUnlocked('unknown', []), { code: 'NOT_FOUND' });
});
