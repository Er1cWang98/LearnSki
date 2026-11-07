import { getLesson } from '../../../catalog/intro';
import type { Lesson } from '../../../domain/types';
import { toLessonView } from '../../presenters/learning';
import type { LearningSession, LessonView } from '../../presenters/learning';

type LearningApp = { globalData: { learning: LearningSession } };

Page({
  data: {
    lesson: null as Lesson | null,
    view: null as LessonView | null,
    notice: '',
    invalid: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    try {
      const lesson = getLesson(query.id ?? '');
      const session = getApp<LearningApp>().globalData.learning;
      this.setData({ lesson, view: toLessonView(lesson, session.state.progress) });
    } catch {
      this.setData({ invalid: true });
    }
  },
  async onShow() {
    const lesson = this.data.lesson;
    if (!lesson) return;
    const session = getApp<LearningApp>().globalData.learning;
    const current = session.state;
    this.setData({ view: toLessonView(lesson, current.progress), notice: current.progress === null ? '进度暂不可用' : current.stale ? '进度未更新' : '' });
    const state = await session.refresh();
    this.setData({ view: toLessonView(lesson, state.progress), notice: state.progress === null ? '进度暂不可用' : state.stale ? '进度未更新' : '' });
  },
});
