import { getLesson, lessons } from '../catalog/intro';
import type { Completion, Progress } from './types';

export function isUnlocked(lessonId: string, completedIds: string[]): boolean {
  const lesson = getLesson(lessonId);
  const done = new Set(completedIds);
  return lesson.prerequisiteIds.every(id => done.has(id));
}

export function getProgress(completions: Completion[]): Progress {
  const valid = new Set(lessons.map(lesson => lesson.id));
  const done = new Set(completions.map(item => item.lessonId).filter(id => valid.has(id)));
  const required = lessons.filter(lesson => !lesson.optional).sort((a, b) => a.order - b.order);
  const requiredDone = required.filter(lesson => done.has(lesson.id)).length;
  return {
    completedIds: [...done],
    requiredDone,
    requiredTotal: required.length,
    nextLessonId: required.find(lesson => !done.has(lesson.id) &&
      lesson.prerequisiteIds.every(id => done.has(id)))?.id ?? null,
    stageComplete: requiredDone === required.length,
  };
}
