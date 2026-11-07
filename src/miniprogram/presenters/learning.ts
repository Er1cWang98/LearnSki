import { getLesson, lessons } from '../../catalog/intro';
import type { LearningApi, Lesson, Progress } from '../../domain/types';

export type LessonStatus = 'locked' | 'available' | 'completed' | 'unknown';

export type LessonView = {
  id: string;
  title: string;
  goal: string;
  status: LessonStatus;
  showFullContent: boolean;
  actionLabel: string;
  statusText: string;
  statusIcon: string;
  optionalText: string;
  prerequisiteText: string;
  numberText: string;
};

export function toLessonView(lesson: Lesson, progress: Progress | null): LessonView {
  const done = new Set(progress?.completedIds ?? []);
  let status: LessonStatus;
  if (done.has(lesson.id)) status = 'completed';
  else if (progress === null) status = lesson.prerequisiteIds.length === 0 ? 'available' : 'unknown';
  else status = lesson.prerequisiteIds.every(id => done.has(id)) ? 'available' : 'locked';

  const labels: Record<LessonStatus, [string, string]> = {
    completed: ['✓', '已自评完成'],
    available: ['›', '可学习'],
    locked: ['—', '待解锁'],
    unknown: ['?', '进度未知'],
  };
  return {
    id: lesson.id,
    title: lesson.title,
    goal: lesson.goal,
    status,
    showFullContent: status === 'available' || status === 'completed',
    actionLabel: status === 'completed' ? '再练一次' : status === 'available' ? '开始练习' : '',
    statusIcon: labels[status][0],
    statusText: labels[status][1],
    optionalText: lesson.optional ? '选修 · 可跳过' : '必修',
    prerequisiteText: lesson.prerequisiteIds.length
      ? `前置课程：${lesson.prerequisiteIds.map(id => getLesson(id).title).join('、')}`
      : '无前置课程',
    numberText: String(lesson.order).padStart(2, '0'),
  };
}

export function toRouteView(progress: Progress | null, stale: boolean) {
  const requiredTotal = lessons.filter(lesson => !lesson.optional).length;
  return {
    completedText: progress ? `${progress.requiredDone} / ${progress.requiredTotal}` : `— / ${requiredTotal}`,
    notice: progress === null ? '进度暂不可用' : stale ? '进度未更新' : '',
    continueLessonId: progress?.nextLessonId ?? 'intro-01',
    continueLabel: progress?.stageComplete ? '复习入门课程' : '继续学习',
    stageComplete: progress?.stageComplete ?? false,
    lessons: lessons.map(lesson => toLessonView(lesson, progress)),
  };
}

export type LearningSessionState = { scope: string | null; progress: Progress | null; stale: boolean };

export function createLearningSession(api: Pick<LearningApi, 'getProgress'>) {
  let state: LearningSessionState = { scope: null, progress: null, stale: false };
  let requestNumber = 0;
  return {
    get state(): LearningSessionState { return state; },
    applyConfirmed(scope: string | null, progress: Progress): boolean {
      if (!scope || (state.scope && state.scope !== scope)) return false;
      ++requestNumber;
      state = { scope, progress, stale: false };
      return true;
    },
    async refresh(): Promise<LearningSessionState> {
      const currentRequest = ++requestNumber;
      try {
        const response = await api.getProgress();
        if (!response.scope || !response.progress) throw { code: 'NETWORK_ERROR' };
        if (currentRequest === requestNumber) {
          state = { scope: response.scope, progress: response.progress, stale: false };
        }
      } catch (error) {
        if (currentRequest === requestNumber) {
          const code = (error as { code?: string })?.code;
          state = code === 'NETWORK_ERROR' && state.scope
            ? { ...state, stale: true }
            : { scope: null, progress: null, stale: false };
        }
      }
      return state;
    },
  };
}

export type LearningSession = ReturnType<typeof createLearningSession>;
