import test from 'node:test';
import assert from 'node:assert/strict';
import { getLesson } from '../src/catalog/intro';
import { validateCommit } from '../src/domain/validation';
import type { CommitInput } from '../src/domain/types';

const lesson = getLesson('intro-01');
const input = (changes: Partial<CommitInput> = {}): CommitInput => ({
  sessionId: 's', fileId: 'f', lessonVersion: 1, checkedIds: [], note: '', result: 'practicing', ...changes,
});

test('completion requires every criterion; practice permits none', () => {
  assert.doesNotThrow(() => validateCommit(lesson, input()));
  assert.throws(() => validateCommit(lesson, input({ result: 'selfCompleted', checkedIds: ['intro-01-name'] })), { code: 'CHECKLIST_INCOMPLETE' });
  assert.doesNotThrow(() => validateCommit(lesson, input({ result: 'selfCompleted', checkedIds: ['intro-01-name', 'intro-01-check', 'intro-01-name'] })));
});

test('unknown criteria, forged version and outcome are rejected', () => {
  assert.throws(() => validateCommit(lesson, input({ checkedIds: ['intro-02-gaze'] })), { code: 'INVALID_INPUT' });
  assert.throws(() => validateCommit(lesson, input({ lessonVersion: 2 })), { code: 'VERSION_CHANGED' });
  assert.throws(() => validateCommit(lesson, input({ result: 'certified' as CommitInput['result'] })), { code: 'INVALID_INPUT' });
});

test('note length counts Unicode code points', () => {
  assert.doesNotThrow(() => validateCommit(lesson, input({ note: '😀'.repeat(500) })));
  assert.throws(() => validateCommit(lesson, input({ note: '😀'.repeat(501) })), { code: 'INVALID_INPUT' });
});
