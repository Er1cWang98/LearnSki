import type { CommitInput, Lesson } from './types';

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export function validateCommit(lesson: Lesson, input: CommitInput): void {
  if (!input || typeof input !== 'object' || typeof input.sessionId !== 'string' || !input.sessionId ||
    typeof input.fileId !== 'string' || !input.fileId || !Array.isArray(input.checkedIds) ||
    !input.checkedIds.every(id => typeof id === 'string') || typeof input.note !== 'string' ||
    [...input.note].length > 500 || (input.result !== 'practicing' && input.result !== 'selfCompleted') ||
    Object.prototype.hasOwnProperty.call(input, 'lessonId')) fail('INVALID_INPUT', '打卡内容无效');
  if (input.lessonVersion !== lesson.version) fail('VERSION_CHANGED', '课程内容已更新');
  const valid = new Set(lesson.criteria.map(item => item.id));
  const checked = new Set(input.checkedIds);
  if ([...checked].some(id => !valid.has(id))) fail('INVALID_INPUT', '考核项无效');
  if (input.result === 'selfCompleted' && [...valid].some(id => !checked.has(id)))
    fail('CHECKLIST_INCOMPLETE', '请完成全部自评项');
}
